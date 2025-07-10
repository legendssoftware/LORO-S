import { Repository } from 'typeorm';
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateBlankQuotationDto } from './dto/create-blank-quotation.dto';
import { PriceListType } from '../lib/enums/product.enums';
import { Quotation } from './entities/quotation.entity';
import { Banners } from './entities/banners.entity';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ProductStatus } from '../lib/enums/product.enums';
import { Product } from '../products/entities/product.entity';
import { startOfDay, endOfDay } from 'date-fns';
import { OrderStatus } from '../lib/enums/status.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { ConfigService } from '@nestjs/config';
import { EmailType } from '../lib/enums/email.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClientsService } from '../clients/clients.service';
import { CreateProductDto } from '../products/dto/create-product.dto';
import { ShopGateway } from './shop.gateway';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { ProductsService } from '../products/products.service';
import { OrganisationService } from '../organisation/organisation.service';
import { QuotationInternalData } from '../lib/types/email-templates.types';
import { PdfGenerationService } from '../pdf-generation/pdf-generation.service';
import { QuotationTemplateData } from '../pdf-generation/interfaces/pdf-templates.interface';

@Injectable()
export class ShopService {
	private readonly currencyLocale: string;
	private currencyCode: string;
	private currencySymbol: string;
	private readonly logger = new Logger(ShopService.name);
	private currencyByOrg: Map<number, { code: string; symbol: string; locale: string }> = new Map();

	constructor(
		@InjectRepository(Product)
		private productRepository: Repository<Product>,
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		@InjectRepository(Banners)
		private bannersRepository: Repository<Banners>,
		private readonly configService: ConfigService,
		private readonly clientsService: ClientsService,
		private readonly eventEmitter: EventEmitter2,
		private readonly shopGateway: ShopGateway,
		private readonly productsService: ProductsService,
		private readonly organisationService: OrganisationService,
		private readonly pdfGenerationService: PdfGenerationService,
	) {
		this.currencyLocale = this.configService.get<string>('CURRENCY_LOCALE') || 'en-ZA';
		this.currencyCode = this.configService.get<string>('CURRENCY_CODE') || 'ZAR';
		this.currencySymbol = this.configService.get<string>('CURRENCY_SYMBOL') || 'R';
	}

	/**
	 * Fetches and caches the currency settings for a specific organization
	 * @param orgId The organization ID to fetch settings for
	 * @returns Object containing the currency code, symbol, and locale
	 */
	private async getOrgCurrency(orgId: number): Promise<{ code: string; symbol: string; locale: string }> {
		// Return defaults if no orgId provided
		if (!orgId) {
			return {
				code: this.currencyCode,
				symbol: this.currencySymbol,
				locale: this.currencyLocale,
			};
		}

		// Return from cache if available
		if (this.currencyByOrg.has(orgId)) {
			return this.currencyByOrg.get(orgId);
		}

		try {
			// Fetch organization with settings relation
			const orgIdStr = String(orgId);
			const { organisation } = await this.organisationService.findOne(orgIdStr);

			// Handle missing organization or settings gracefully
			if (!organisation || !organisation.settings || !organisation.settings.regional) {
				this.logger.warn(`Organization ${orgId} settings not found, using defaults`);
				return {
					code: this.currencyCode,
					symbol: this.currencySymbol,
					locale: this.currencyLocale,
				};
			}

			// Extract currency from org settings with fallback
			const orgCurrency = organisation.settings.regional.currency;
			if (!orgCurrency) {
				this.logger.warn(`Currency not set for organization ${orgId}, using defaults`);
				return {
					code: this.currencyCode,
					symbol: this.currencySymbol,
					locale: this.currencyLocale,
				};
			}

			// Map currency to appropriate symbol and locale (add more as needed)
			const currencyMap = {
				USD: { symbol: '$', locale: 'en-US' },
				EUR: { symbol: '€', locale: 'en-EU' },
				GBP: { symbol: '£', locale: 'en-GB' },
				ZAR: { symbol: 'R', locale: 'en-ZA' },
				// Add more currencies as needed
			};

			// Get currency details or use defaults
			const currencyDetails = currencyMap[orgCurrency] || {
				symbol: this.currencySymbol,
				locale: this.currencyLocale,
			};

			const result = {
				code: orgCurrency,
				symbol: currencyDetails.symbol,
				locale: currencyDetails.locale,
			};

			// Cache the result
			this.currencyByOrg.set(orgId, result);

			return result;
		} catch (error) {
			this.logger.warn(`Error fetching organization currency: ${error.message}, using defaults`);

			// Return defaults on error
			return {
				code: this.currencyCode,
				symbol: this.currencySymbol,
				locale: this.currencyLocale,
			};
		}
	}

	// Original method - keep for backward compatibility
	private formatCurrency(amount: number): string {
		return new Intl.NumberFormat(this.currencyLocale, {
			style: 'currency',
			currency: this.currencyCode,
		})
			.format(amount)
			.replace(this.currencyCode, this.currencySymbol);
	}

	async categories(orgId?: number, branchId?: number): Promise<{ categories: string[] | null; message: string }> {
		try {
			// Build query with optional org and branch filters
			const query = this.productRepository.createQueryBuilder('product');

			// Only add filters if values are provided
			if (orgId) {
				query.andWhere('product.organisationUid = :orgId', { orgId });
			}

			if (branchId) {
				query.andWhere('product.branchUid = :branchId', { branchId });
			}

			const allProducts = await query.getMany();

			// Return empty categories array if no products found instead of throwing error
			if (!allProducts || allProducts?.length === 0) {
				return {
					categories: [],
					message: 'No products found',
				};
			}

			const categories = allProducts.map((product) => product?.category);
			const uniqueCategories = [...new Set(categories)].filter(Boolean); // Filter out null/undefined values

			const response = {
				categories: uniqueCategories,
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message || 'Error fetching categories',
				categories: [],
			};

			return response;
		}
	}

	private async getProductsByStatus(
		status: ProductStatus,
		orgId?: number,
		branchId?: number,
	): Promise<{ products: Product[] | null }> {
		try {
			// Build query with orgId and branchId as optional filters
			// Only select fields that exist in the database to avoid column errors
			const query = this.productRepository
				.createQueryBuilder('product')
				.select([
					'product.uid',
					'product.name', 
					'product.description',
					'product.price',
					'product.category',
					'product.status',
					'product.imageUrl',
					'product.sku',
					'product.warehouseLocation',
					'product.stockQuantity',
					'product.productRef',
					'product.productReferenceCode',
					'product.reorderPoint',
					'product.salePrice',
					'product.discount',
					'product.barcode',
					'product.brand',
					'product.packageQuantity',
					'product.weight',
					'product.isOnPromotion',
					'product.packageDetails',
					'product.promotionStartDate',
					'product.promotionEndDate',
					'product.packageUnit',
					'product.createdAt',
					'product.updatedAt',
					'product.isDeleted'
				])
				.where('product.status = :status', { status });

			// Only add org filter if orgId is provided
			if (orgId) {
				query.andWhere('product.organisationUid = :orgId', { orgId });
			}

			// Only add branch filter if branchId is provided
			if (branchId) {
				query.andWhere('product.branchUid = :branchId', { branchId });
			}

			const products = await query.getMany();

			return { products: products ?? [] }; // Return empty array instead of null if no products
		} catch (error) {
			this.logger.warn(`Error fetching products by status: ${error?.message}`);
			return { products: [] }; // Return empty array on error
		}
	}

	async specials(orgId?: number, branchId?: number): Promise<{ products: Product[] | null; message: string }> {
		const result = await this.getProductsByStatus(ProductStatus.SPECIAL, orgId, branchId);

		const response = {
			products: result?.products,
			message: process.env.SUCCESS_MESSAGE,
		};

		return response;
	}

	async getBestSellers(orgId?: number, branchId?: number): Promise<{ products: Product[] | null; message: string }> {
		try {
			// Get products based on actual sales analytics or fallback to status
			const query = this.productRepository
				.createQueryBuilder('product')
				.leftJoin('product.analytics', 'analytics')
				.select([
					'product.uid',
					'product.name', 
					'product.description',
					'product.price',
					'product.category',
					'product.status',
					'product.imageUrl',
					'product.sku',
					'product.warehouseLocation',
					'product.stockQuantity',
					'product.productRef',
					'product.productReferenceCode',
					'product.reorderPoint',
					'product.salePrice',
					'product.discount',
					'product.barcode',
					'product.brand',
					'product.packageQuantity',
					'product.weight',
					'product.isOnPromotion',
					'product.packageDetails',
					'product.promotionStartDate',
					'product.promotionEndDate',
					'product.packageUnit',
					'product.itemsPerPack',
					'product.packsPerPallet',
					'product.packPrice',
					'product.palletPrice',
					'product.packWeight',
					'product.palletWeight',
					'product.dimensions',
					'product.packDimensions',
					'product.palletDimensions',
					'product.manufacturer',
					'product.model',
					'product.color',
					'product.material',
					'product.warrantyPeriod',
					'product.warrantyUnit',
					'product.specifications',
					'product.features',
					'product.rating',
					'product.reviewCount',
					'product.origin',
					'product.isFragile',
					'product.requiresSpecialHandling',
					'product.storageConditions',
					'product.minimumOrderQuantity',
					'product.bulkDiscountPercentage',
					'product.bulkDiscountMinQty',
					'product.createdAt',
					'product.updatedAt',
					'product.isDeleted'
				])
				.where('product.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('product.stockQuantity > 0') // Only show products in stock
				.andWhere('product.status != :inactive', { inactive: ProductStatus.INACTIVE });

			// Only add org filter if orgId is provided
			if (orgId) {
				query.andWhere('product.organisationUid = :orgId', { orgId });
			}

			// Only add branch filter if branchId is provided
			if (branchId) {
				query.andWhere('product.branchUid = :branchId', { branchId });
			}

			// Order by sales analytics first, then by status, then by creation date
			query
				.addSelect('COALESCE(analytics.totalUnitsSold, 0)', 'totalSold')
				.addSelect('COALESCE(analytics.salesCount, 0)', 'salesCount')
				.orderBy('COALESCE(analytics.totalUnitsSold, 0)', 'DESC')
				.addOrderBy('CASE WHEN product.status = :bestSeller THEN 1 ELSE 2 END', 'ASC')
				.addOrderBy('product.createdAt', 'DESC')
				.setParameter('bestSeller', ProductStatus.BEST_SELLER)
				.limit(20); // Limit to 20 best sellers

			const products = await query.getMany();

			const response = {
				products: products ?? [],
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			this.logger.warn(`Error fetching best sellers: ${error?.message}`);
			return {
				products: [],
				message: 'Error fetching best sellers',
			};
		}
	}

	async getNewArrivals(orgId?: number, branchId?: number): Promise<{ products: Product[] | null; message: string }> {
		try {
			// Get the most recently added products (within last 30 days or newest 20)
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			const query = this.productRepository
				.createQueryBuilder('product')
				.select([
					'product.uid',
					'product.name', 
					'product.description',
					'product.price',
					'product.category',
					'product.status',
					'product.imageUrl',
					'product.sku',
					'product.warehouseLocation',
					'product.stockQuantity',
					'product.productRef',
					'product.productReferenceCode',
					'product.reorderPoint',
					'product.salePrice',
					'product.discount',
					'product.barcode',
					'product.brand',
					'product.packageQuantity',
					'product.weight',
					'product.isOnPromotion',
					'product.packageDetails',
					'product.promotionStartDate',
					'product.promotionEndDate',
					'product.packageUnit',
					'product.itemsPerPack',
					'product.packsPerPallet',
					'product.packPrice',
					'product.palletPrice',
					'product.packWeight',
					'product.palletWeight',
					'product.dimensions',
					'product.packDimensions',
					'product.palletDimensions',
					'product.manufacturer',
					'product.model',
					'product.color',
					'product.material',
					'product.warrantyPeriod',
					'product.warrantyUnit',
					'product.specifications',
					'product.features',
					'product.rating',
					'product.reviewCount',
					'product.origin',
					'product.isFragile',
					'product.requiresSpecialHandling',
					'product.storageConditions',
					'product.minimumOrderQuantity',
					'product.bulkDiscountPercentage',
					'product.bulkDiscountMinQty',
					'product.createdAt',
					'product.updatedAt',
					'product.isDeleted'
				])
				.where('product.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('product.stockQuantity > 0') // Only show products in stock
				.andWhere('product.status != :inactive', { inactive: ProductStatus.INACTIVE })
				.andWhere('(product.createdAt >= :thirtyDaysAgo OR product.status = :newStatus)', {
					thirtyDaysAgo,
					newStatus: ProductStatus.NEW
				});

			// Only add org filter if orgId is provided
			if (orgId) {
				query.andWhere('product.organisationUid = :orgId', { orgId });
			}

			// Only add branch filter if branchId is provided
			if (branchId) {
				query.andWhere('product.branchUid = :branchId', { branchId });
			}

			// Order by creation date (newest first), prioritizing NEW status
			query
				.orderBy('CASE WHEN product.status = :newStatus THEN 1 ELSE 2 END', 'ASC')
				.addOrderBy('product.createdAt', 'DESC')
				.setParameter('newStatus', ProductStatus.NEW)
				.limit(20); // Limit to 20 new arrivals

			const products = await query.getMany();

			const response = {
				products: products ?? [],
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			this.logger.warn(`Error fetching new arrivals: ${error?.message}`);
			return {
				products: [],
				message: 'Error fetching new arrivals',
			};
		}
	}

	async getHotDeals(orgId?: number, branchId?: number): Promise<{ products: Product[] | null; message: string }> {
		const result = await this.getProductsByStatus(ProductStatus.HOTDEALS, orgId, branchId);

		const response = {
			products: result.products,
			message: process.env.SUCCESS_MESSAGE,
		};

		return response;
	}

	async createQuotation(quotationData: CheckoutDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			if (!quotationData?.items?.length) {
				throw new Error('Quotation items are required');
			}

			if (!quotationData?.owner?.uid) {
				throw new Error('Owner is required');
			}

			if (!quotationData?.client?.uid) {
				throw new Error('Client is required');
			}

			// Get organization-specific currency settings
			const orgCurrency = await this.getOrgCurrency(orgId);

			const clientData = await this.clientsService?.findOne(Number(quotationData?.client?.uid));

			if (!clientData) {
				throw new NotFoundException(process.env.CLIENT_NOT_FOUND_MESSAGE);
			}

			const { name: clientName } = clientData?.client;
			const internalEmail = this.configService.get<string>('INTERNAL_BROADCAST_EMAIL');

			const productPromises = quotationData?.items?.map((item) =>
				this.productRepository.find({ where: { uid: item?.uid }, relations: ['reseller'] }),
			);

			const products = await Promise.all(productPromises);

			const resellerEmails = products
				.flat()
				.map((product) => ({
					email: product?.reseller?.email,
					retailerName: product?.reseller?.name,
				}))
				.filter((email) => email?.email)
				.reduce((unique, item) => {
					return unique?.some((u) => u?.email === item?.email) ? unique : [...unique, item];
				}, []);

			// Create a map of product UIDs to their references
			const productRefs = new Map(products.flat().map((product) => [product.uid, product.productRef]));

			// Validate that all products were found
			const missingProducts = quotationData?.items?.filter((item) => !productRefs.has(item.uid));

			if (missingProducts?.length > 0) {
				throw new Error(`Products not found for items: ${missingProducts.map((item) => item.uid).join(', ')}`);
			}

			// Generate a unique review token for the quotation
			const timestamp = Date.now();
			const reviewToken = Buffer.from(
				`${quotationData?.client?.uid}-${timestamp}-${Math.random().toString(36).substring(2, 15)}`,
			).toString('base64');
			const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://loro.co.za/review-quotation';
			const reviewUrl = `${frontendUrl}?token=${reviewToken}`;

			const newQuotation = {
				quotationNumber: `QUO-${Date.now()}`,
				totalItems: Number(quotationData?.totalItems),
				totalAmount: Number(quotationData?.totalAmount),
				placedBy: { uid: quotationData?.owner?.uid },
				client: { uid: quotationData?.client?.uid },
				status: OrderStatus.DRAFT,
				quotationDate: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
				reviewToken: reviewToken,
				reviewUrl: reviewUrl,
				promoCode: quotationData?.promoCode,
				// Store currency code with the quotation
				currency: orgCurrency.code,
				quotationItems: quotationData?.items?.map((item) => {
					const product = products.flat().find((p) => p.uid === item.uid);
					// Use the pricing from the frontend which already calculated palette vs item pricing
					const unitPrice = Number(item?.unitPrice || product?.price || 0);
					const totalPrice = Number(item?.totalPrice || (item?.quantity * unitPrice));
					
					return {
						quantity: Number(item?.quantity),
						product: {
							uid: item?.uid,
							name: product?.name,
							sku: item?.sku || product?.sku, // Use SKU from item (might be palette SKU)
							productRef: product?.productRef,
							price: product?.price,
						},
						unitPrice: unitPrice,
						totalPrice: totalPrice,
						purchaseMode: item?.purchaseMode || 'item', // Track the purchase mode
						itemsPerUnit: Number(item?.itemsPerUnit || 1), // Track actual items
						createdAt: new Date(),
						updatedAt: new Date(),
					};
				}),
				// Assign organisation and branch as relation objects if IDs exist
				...(orgId && { organisation: { uid: orgId } }), // Assumes relation name is 'organisation' and expects { uid: ... }
				...(branchId && { branch: { uid: branchId } }),
			};

			// Add organization and branch if available - DIRECT COLUMN VALUES
			if (orgId) {
				// Store as direct column value instead of relation to ensure it's saved properly
				newQuotation['organisationUid'] = orgId;
			}

			if (branchId) {
				// Store as direct column value instead of relation to ensure it's saved properly
				newQuotation['branchUid'] = branchId;
			}

			const savedQuotation = await this.quotationRepository.save(newQuotation);

			// Trigger recalculation of user targets for the owner after a new quotation (checkout)
			if (quotationData?.owner?.uid && this.eventEmitter) {
				this.eventEmitter.emit('user.target.update.required', { userId: quotationData.owner.uid });
			}

			// Generate PDF for the quotation
			// First get the full quotation with all relations for PDF generation
			const fullQuotation = await this.quotationRepository.findOne({
				where: { uid: savedQuotation.uid },
				relations: ['client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
			});

			if (fullQuotation) {
				const pdfUrl = await this.generateQuotationPDF(fullQuotation);

				// If PDF was generated successfully, update the quotation record
				if (pdfUrl) {
					await this.quotationRepository.update(savedQuotation.uid, { pdfURL: pdfUrl });
				}
			}

			// Update analytics for each product
			for (const item of quotationData.items) {
				const product = products.flat().find((p) => p.uid === item.uid);
				if (product) {
					// Record view and cart add
					await this.productsService.recordView(product.uid);
					await this.productsService.recordCartAdd(product.uid);

					// Update stock history
					await this.productsService.updateStockHistory(product.uid, item.quantity, 'out');

					// Calculate updated performance metrics
					await this.productsService.calculateProductPerformance(product.uid);
				}
			}

			// Emit WebSocket event for new quotation with full data
			// Get the full quotation with all relations for WebSocket
			const fullQuotationForSocket = await this.quotationRepository.findOne({
				where: { uid: savedQuotation.uid },
				relations: ['client', 'placedBy', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
			});
			
			if (fullQuotationForSocket) {
				this.shopGateway.emitNewQuotation(fullQuotationForSocket);
			}

			const baseConfig: QuotationInternalData = {
				name: clientName,
				quotationId: savedQuotation?.quotationNumber,
				validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days validity
				total: Number(savedQuotation?.totalAmount),
				currency: orgCurrency.code, // Use organization's currency code
				reviewUrl: savedQuotation.reviewUrl,
				customerType: clientData?.client?.type || 'standard', // Assuming client type exists, add a fallback
				priority: 'high', // Add default priority for internal notification
				quotationItems: quotationData?.items?.map((item) => {
					const product = products.flat().find((p) => p.uid === item.uid);
					const purchaseMode = item?.purchaseMode || 'item';
					const itemsPerUnit = Number(item?.itemsPerUnit || 1);
					
					return {
						quantity: Number(item?.quantity),
						product: {
							uid: item?.uid,
							name: product?.name || 'Unknown Product',
							code: product?.productRef || 'N/A',
						},
						totalPrice: Number(item?.totalPrice),
						purchaseMode: purchaseMode,
						itemsPerUnit: itemsPerUnit,
						actualItems: Number(item?.quantity) * itemsPerUnit, // Total individual items
					};
				}),
			};

			// Only send internal notification and order acknowledgment to client
			// Do NOT send the full quotation to the client yet

			// Notify internal team about new quotation
			this.eventEmitter.emit('send.email', EmailType.NEW_QUOTATION_INTERNAL, [internalEmail], baseConfig);

			// Notify resellers about products in the quotation
			resellerEmails?.forEach((email) => {
				this.eventEmitter.emit('send.email', EmailType.NEW_QUOTATION_RESELLER, [email?.email], {
					...baseConfig,
					name: email?.retailerName,
					email: email?.email,
				});
			});

			// Send order acknowledgment to client (NOT the full quotation)
			this.eventEmitter.emit('send.email', EmailType.ORDER_RECEIVED_CLIENT, [clientData?.client?.email], {
				name: clientName,
				quotationId: savedQuotation?.quotationNumber,
				// Don't include detailed information yet
				message: 'We have received your order request and will prepare a quotation for you shortly.',
			});

					return {
			message: process.env.SUCCESS_MESSAGE,
		};
	} catch (error) {
		this.logger.error(`Error creating quotation: ${error.message}`, error.stack);
		return {
			message: error?.message,
		};
	}
}

	async createBlankQuotation(
		blankQuotationData: CreateBlankQuotationDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; quotationId?: string }> {
		try {
			this.logger.log(`[createBlankQuotation] Starting blank quotation creation for orgId: ${orgId}, branchId: ${branchId}`);

			if (!blankQuotationData?.items?.length) {
				this.logger.error('[createBlankQuotation] No items provided');
				throw new Error('Blank quotation items are required');
			}

			if (!blankQuotationData?.owner?.uid) {
				this.logger.error('[createBlankQuotation] No owner provided');
				throw new Error('Owner is required');
			}

			if (!blankQuotationData?.client?.uid) {
				this.logger.error('[createBlankQuotation] No client provided');
				throw new Error('Client is required');
			}

			this.logger.log(`[createBlankQuotation] Validating request - Items: ${blankQuotationData.items.length}, Owner: ${blankQuotationData.owner.uid}, Client: ${blankQuotationData.client.uid}`);

			// Get organization-specific currency settings
			const orgCurrency = await this.getOrgCurrency(orgId);
			this.logger.log(`[createBlankQuotation] Organization currency: ${orgCurrency.code}`);

			const clientData = await this.clientsService?.findOne(Number(blankQuotationData?.client?.uid));

			if (!clientData) {
				this.logger.error(`[createBlankQuotation] Client not found: ${blankQuotationData?.client?.uid}`);
				throw new NotFoundException(process.env.CLIENT_NOT_FOUND_MESSAGE);
			}

			const { name: clientName, email: clientEmail } = clientData?.client;
			const internalEmail = this.configService.get<string>('INTERNAL_BROADCAST_EMAIL');
			this.logger.log(`[createBlankQuotation] Client found: ${clientName} (${clientEmail})`);

			// Get products with their pricing information
			this.logger.log(`[createBlankQuotation] Fetching product details for ${blankQuotationData.items.length} items`);
			const productPromises = blankQuotationData?.items?.map((item) =>
				this.productRepository.find({ where: { uid: item?.uid }, relations: ['reseller'] }),
			);

			const products = await Promise.all(productPromises);

			// Get reseller emails for notifications (same as regular quotation)
			const resellerEmails = products
				.flat()
				.map((product) => ({
					email: product?.reseller?.email,
					retailerName: product?.reseller?.name,
				}))
				.filter((email) => email?.email)
				.reduce((unique, item) => {
					return unique?.some((u) => u?.email === item?.email) ? unique : [...unique, item];
				}, []);

			this.logger.log(`[createBlankQuotation] Found ${resellerEmails.length} resellers to notify`);

			// Create a map of product UIDs to their details
			const productMap = new Map(products.flat().map((product) => [product.uid, product]));

			// Validate that all products were found
			const missingProducts = blankQuotationData?.items?.filter((item) => !productMap.has(item.uid));

			if (missingProducts?.length > 0) {
				this.logger.error(`[createBlankQuotation] Missing products: ${missingProducts.map((item) => item.uid).join(', ')}`);
				throw new Error(`Products not found for items: ${missingProducts.map((item) => item.uid).join(', ')}`);
			}

			this.logger.log(`[createBlankQuotation] All ${blankQuotationData.items.length} products found`);

			// Generate a unique review token for the quotation
			const timestamp = Date.now();
			const reviewToken = Buffer.from(
				`${blankQuotationData?.client?.uid}-${timestamp}-${Math.random().toString(36).substring(2, 15)}`,
			).toString('base64');
			const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://loro.co.za/review-quotation';
			const reviewUrl = `${frontendUrl}?token=${reviewToken}`;

			// Calculate pricing based on price list type
			let totalAmount = 0;
			let totalItems = 0;

			this.logger.log(`[createBlankQuotation] Calculating pricing using price list type: ${blankQuotationData.priceListType}`);

			const quotationItems = blankQuotationData?.items
				?.filter((item) => item.included !== false) // Only include items that are not explicitly excluded
				?.map((item) => {
					const product = productMap.get(item.uid);
					const quantity = Number(item?.quantity);
					
					// Calculate price based on price list type
					let unitPrice = this.calculatePriceByType(product, blankQuotationData.priceListType);
					let itemTotalPrice = unitPrice * quantity;

					totalAmount += itemTotalPrice;
					totalItems += quantity;

					this.logger.log(`[createBlankQuotation] Item ${product?.name}: ${quantity} x ${unitPrice} = ${itemTotalPrice}`);

					return {
						quantity: quantity,
						product: {
							uid: item?.uid,
							name: product?.name,
							sku: product?.sku,
							productRef: product?.productRef,
							price: product?.price,
						},
						unitPrice: unitPrice,
						totalPrice: itemTotalPrice,
						purchaseMode: 'item',
						itemsPerUnit: 1,
						notes: item?.notes,
						priceListType: blankQuotationData.priceListType,
						createdAt: new Date(),
						updatedAt: new Date(),
					};
				});

			const quotationNumber = `BLQ-${Date.now()}`; // BLQ for Blank Quotation
			this.logger.log(`[createBlankQuotation] Generated quotation number: ${quotationNumber}`);
			this.logger.log(`[createBlankQuotation] Total amount: ${totalAmount}, Total items: ${totalItems}`);

			const newQuotation = {
				quotationNumber: quotationNumber,
				totalItems: totalItems,
				totalAmount: totalAmount,
				placedBy: { uid: blankQuotationData?.owner?.uid },
				client: { uid: blankQuotationData?.client?.uid },
				status: OrderStatus.DRAFT,
				quotationDate: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
				reviewToken: reviewToken,
				reviewUrl: reviewUrl,
				promoCode: blankQuotationData?.promoCode,
				currency: orgCurrency.code,
				title: blankQuotationData?.title || 'Blank Quotation',
				description: blankQuotationData?.description || 'Price list quotation for your review',
				priceListType: blankQuotationData.priceListType,
				isBlankQuotation: true,
				quotationItems: quotationItems,
				// Store org and branch associations
				...(orgId && { organisationUid: orgId }),
				...(branchId && { branchUid: branchId }),
			};

			this.logger.log(`[createBlankQuotation] Saving quotation to database`);
			const savedQuotation = await this.quotationRepository.save(newQuotation);
			this.logger.log(`[createBlankQuotation] Quotation saved with ID: ${savedQuotation.uid}`);

			// Trigger recalculation of user targets for the owner (same as regular quotation)
			if (blankQuotationData?.owner?.uid && this.eventEmitter) {
				this.logger.log(`[createBlankQuotation] Triggering target update for user: ${blankQuotationData.owner.uid}`);
				this.eventEmitter.emit('user.target.update.required', { userId: blankQuotationData.owner.uid });
			}

			// Generate PDF for the quotation
			this.logger.log(`[createBlankQuotation] Generating PDF for quotation`);
			const fullQuotation = await this.quotationRepository.findOne({
				where: { uid: savedQuotation.uid },
				relations: ['client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
			});

			if (fullQuotation) {
				const pdfUrl = await this.generateQuotationPDF(fullQuotation);
				if (pdfUrl) {
					this.logger.log(`[createBlankQuotation] PDF generated successfully: ${pdfUrl}`);
					await this.quotationRepository.update(savedQuotation.uid, { pdfURL: pdfUrl });
				} else {
					this.logger.warn(`[createBlankQuotation] Failed to generate PDF`);
				}
			}

			// Update analytics for each product (same as regular quotation)
			this.logger.log(`[createBlankQuotation] Updating product analytics for ${blankQuotationData.items.length} items`);
			for (const item of blankQuotationData.items) {
				const product = productMap.get(item.uid);
				if (product) {
					try {
						// Record view and cart add
						await this.productsService.recordView(product.uid);
						await this.productsService.recordCartAdd(product.uid);

						// Update stock history
						await this.productsService.updateStockHistory(product.uid, item.quantity, 'out');

						// Calculate updated performance metrics
						await this.productsService.calculateProductPerformance(product.uid);

						this.logger.log(`[createBlankQuotation] Analytics updated for product: ${product.name} (${product.uid})`);
					} catch (analyticsError) {
						this.logger.warn(`[createBlankQuotation] Failed to update analytics for product ${product.uid}: ${analyticsError.message}`);
					}
				}
			}

			// Emit WebSocket event for new blank quotation with full data
			this.logger.log(`[createBlankQuotation] Emitting WebSocket event`);
			// Get the full quotation with all relations for WebSocket
			const fullBlankQuotationForSocket = await this.quotationRepository.findOne({
				where: { uid: savedQuotation.uid },
				relations: ['client', 'placedBy', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
			});
			
			if (fullBlankQuotationForSocket) {
				this.shopGateway.emitNewQuotation(fullBlankQuotationForSocket);
			}

			// Prepare email data for blank quotation
			const emailData = {
				name: clientName,
				quotationId: savedQuotation?.quotationNumber,
				validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days validity
				total: Number(savedQuotation?.totalAmount),
				currency: orgCurrency.code,
				reviewUrl: savedQuotation.reviewUrl,
				priceListType: blankQuotationData.priceListType,
				title: blankQuotationData?.title || 'Blank Quotation',
				description: blankQuotationData?.description || 'Price list quotation for your review',
				customerType: clientData?.client?.type || 'standard', // Add customer type like regular quotation
				priority: 'medium', // Add priority for blank quotations
				quotationItems: quotationItems.map((item) => ({
					quantity: item.quantity,
					product: {
						uid: item.product.uid,
						name: item.product.name,
						code: item.product.productRef || item.product.sku,
					},
					unitPrice: item.unitPrice,
					totalPrice: item.totalPrice,
					notes: item.notes,
					purchaseMode: item.purchaseMode,
					itemsPerUnit: item.itemsPerUnit,
					actualItems: item.quantity * item.itemsPerUnit,
				})),
				pdfURL: fullQuotation?.pdfURL,
			};

			// Send email to recipient if provided, otherwise to client
			const recipientEmail = blankQuotationData?.recipientEmail || clientEmail;
			if (recipientEmail) {
				this.logger.log(`[createBlankQuotation] Sending client email to: ${recipientEmail}`);
				this.eventEmitter.emit('send.email', EmailType.BLANK_QUOTATION_CLIENT, [recipientEmail], emailData);
			}

			// Notify internal team about new blank quotation
			this.logger.log(`[createBlankQuotation] Sending internal notification to: ${internalEmail}`);
			this.eventEmitter.emit('send.email', EmailType.BLANK_QUOTATION_INTERNAL, [internalEmail], emailData);

			// Notify resellers about products in the blank quotation (same as regular quotation)
			if (resellerEmails?.length > 0) {
				this.logger.log(`[createBlankQuotation] Notifying ${resellerEmails.length} resellers`);
				resellerEmails?.forEach((email) => {
					this.eventEmitter.emit('send.email', EmailType.NEW_QUOTATION_RESELLER, [email?.email], {
						...emailData,
						name: email?.retailerName,
						email: email?.email,
					});
				});
			}

			this.logger.log(`[createBlankQuotation] Blank quotation creation completed successfully: ${quotationNumber}`);

			return {
				message: process.env.SUCCESS_MESSAGE,
				quotationId: savedQuotation?.quotationNumber,
			};
		} catch (error) {
			this.logger.error(`[createBlankQuotation] Error creating blank quotation: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Calculate price based on price list type
	 * @param product The product to calculate price for
	 * @param priceListType The price list type to use
	 * @returns The calculated price
	 */
	private calculatePriceByType(product: Product, priceListType: PriceListType): number {
		const basePrice = Number(product?.price || 0);
		const salePrice = Number(product?.salePrice || 0);

		switch (priceListType) {
			case PriceListType.PREMIUM:
				return basePrice * 1.2; // 20% markup
			case PriceListType.NEW:
				return salePrice > 0 ? salePrice : basePrice;
			case PriceListType.LOCAL:
				return basePrice * 0.95; // 5% discount
			case PriceListType.FOREIGN:
				return basePrice * 1.15; // 15% markup for foreign
			case PriceListType.WHOLESALE:
				return basePrice * 0.85; // 15% discount for wholesale
			case PriceListType.BULK:
				return basePrice * 0.8; // 20% discount for bulk
			case PriceListType.RETAIL:
				return basePrice * 1.1; // 10% markup for retail
			case PriceListType.STANDARD:
			default:
				return basePrice;
		}
	}

	async createBanner(
		bannerData: CreateBannerDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ banner: Banners | null; message: string }> {
		try {
			// Create the banner with the correct field names for organization and branch
			const bannerToSave = {
				...bannerData,
			};

			// Only add organization and branch if they exist
			if (orgId) {
				bannerToSave['organisationUid'] = orgId;
			}

			if (branchId) {
				bannerToSave['branchUid'] = branchId;
			}

			const banner = await this.bannersRepository.save(bannerToSave);

			return {
				banner,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				banner: null,
				message: error?.message,
			};
		}
	}

	async getBanner(orgId?: number, branchId?: number): Promise<{ banners: Banners[]; message: string }> {
		try {
			const query = this.bannersRepository.createQueryBuilder('banner');

			if (orgId) {
				query.andWhere('banner.organisationUid = :orgId', { orgId });
			}

			if (branchId) {
				query.andWhere('banner.branchUid = :branchId', { branchId });
			}

			const banners = await query.getMany();

			return {
				banners,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				banners: [],
				message: error?.message,
			};
		}
	}

	async updateBanner(
		uid: number,
		bannerData: UpdateBannerDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ banner: Banners | null; message: string }> {
		try {
			// Find the banner first to apply filters
			const query = this.bannersRepository.createQueryBuilder('banner').where('banner.uid = :uid', { uid });

			if (orgId) {
				query.andWhere('banner.organisationUid = :orgId', { orgId });
			}

			if (branchId) {
				query.andWhere('banner.branchUid = :branchId', { branchId });
			}

			const banner = await query.getOne();

			if (!banner) {
				throw new NotFoundException('Banner not found');
			}

			// Update the banner
			await this.bannersRepository.update(uid, bannerData);

			// Get the updated banner
			const updatedBanner = await this.bannersRepository.findOne({
				where: { uid },
			});

			return {
				banner: updatedBanner,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				banner: null,
				message: error?.message,
			};
		}
	}

	async deleteBanner(uid: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			// Find the banner first to apply filters
			const query = this.bannersRepository.createQueryBuilder('banner').where('banner.uid = :uid', { uid });

			if (orgId) {
				query.andWhere('banner.organisationUid = :orgId', { orgId });
			}

			if (branchId) {
				query.andWhere('banner.branchUid = :branchId', { branchId });
			}

			const banner = await query.getOne();

			if (!banner) {
				throw new NotFoundException('Banner not found');
			}

			// Delete the banner
			await this.bannersRepository.delete(uid);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	async getAllQuotations(orgId?: number, branchId?: number, userId?: number, userRole?: AccessLevel): Promise<{ quotations: Quotation[]; message: string }> {
		try {
			const query = this.quotationRepository
				.createQueryBuilder('quotation')
				.leftJoinAndSelect('quotation.client', 'client')
				.leftJoinAndSelect('quotation.placedBy', 'placedBy')
				.leftJoinAndSelect('quotation.quotationItems', 'quotationItems')
				.leftJoinAndSelect('quotationItems.product', 'product')
				.orderBy('quotation.createdAt', 'DESC');

			// Add filtering by org and branch
			if (orgId) {
				query.andWhere('quotation.organisationUid = :orgId', { orgId });
			}

			if (branchId) {
				query.andWhere('quotation.branchUid = :branchId', { branchId });
			}

			// Role-based filtering: Only ADMIN, OWNER, DEVELOPER, MANAGER can see all quotations
			// Other users can only see their own quotations
			const privilegedRoles = [AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER, AccessLevel.MANAGER];
			const isPrivilegedUser = privilegedRoles.includes(userRole);
			
			if (!isPrivilegedUser && userId) {
				query.andWhere('placedBy.uid = :userId', { userId });
			}

			const quotations = await query.getMany();

			return {
				quotations,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				quotations: [],
				message: error?.message,
			};
		}
	}

	async getQuotationsByUser(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ quotations: Quotation[]; message: string }> {
		try {
			const query = this.quotationRepository
				.createQueryBuilder('quotation')
				.leftJoinAndSelect('quotation.client', 'client')
				.leftJoinAndSelect('quotation.placedBy', 'placedBy')
				.leftJoinAndSelect('quotation.quotationItems', 'quotationItems')
				.leftJoinAndSelect('quotationItems.product', 'product')
				.where('placedBy.uid = :ref', { ref });

			// Add filtering by org and branch
			if (orgId) {
				query.andWhere('quotation.organisationUid = :orgId', { orgId });
			}

			if (branchId) {
				query.andWhere('quotation.branchUid = :branchId', { branchId });
			}

			const quotations = await query.getMany();

			if (!quotations?.length) {
				throw new NotFoundException(process.env.QUOTATION_NOT_FOUND_MESSAGE);
			}

			return {
				quotations,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				quotations: [],
				message: error?.message,
			};
		}
	}

	async getQuotationByRef(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ quotation: Quotation; message: string }> {
		try {
			const query = this.quotationRepository
				.createQueryBuilder('quotation')
				.leftJoinAndSelect('quotation.client', 'client')
				.leftJoinAndSelect('quotation.placedBy', 'placedBy')
				.leftJoinAndSelect('quotation.quotationItems', 'quotationItems')
				.leftJoinAndSelect('quotationItems.product', 'product')
				.where('quotation.uid = :ref', { ref });

			// Add filtering by org and branch
			if (orgId) {
				query.andWhere('quotation.organisationUid = :orgId', { orgId });
			}

			if (branchId) {
				query.andWhere('quotation.branchUid = :branchId', { branchId });
			}

			const quotation = await query.getOne();

			if (!quotation) {
				throw new NotFoundException(process.env.QUOTATION_NOT_FOUND_MESSAGE);
			}
			

			return {
				quotation,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				quotation: null,
				message: error?.message,
			};
		}
	}

	async getQuotationsForDate(
		date: Date,
		orgId?: number,
		branchId?: number,
	): Promise<{
		message: string;
		stats: {
			quotations: {
				pending: Quotation[];
				processing: Quotation[];
				completed: Quotation[];
				cancelled: Quotation[];
				postponed: Quotation[];
				rejected: Quotation[];
				approved: Quotation[];
				metrics: {
					totalQuotations: number;
					grossQuotationValue: string;
					averageQuotationValue: string;
				};
			};
		};
	}> {
		try {
			const queryBuilder = this.quotationRepository
				.createQueryBuilder('quotation')
				.where('quotation.createdAt BETWEEN :startDate AND :endDate', {
					startDate: startOfDay(date),
					endDate: endOfDay(date),
				})
				.leftJoinAndSelect('quotation.quotationItems', 'quotationItems');

			if (orgId) {
				queryBuilder
					.leftJoinAndSelect('quotation.organisation', 'organisation')
					.andWhere('organisation.uid = :orgId', { orgId });
			}

			if (branchId) {
				queryBuilder
					.leftJoinAndSelect('quotation.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			const quotations = await queryBuilder.getMany();

			if (!quotations) {
				throw new Error(process.env.NOT_FOUND_MESSAGE);
			}

			// Group quotations by status
			const groupedQuotations = {
				pending: quotations.filter((quotation) => quotation?.status === OrderStatus.PENDING),
				processing: quotations.filter((quotation) => quotation?.status === OrderStatus.INPROGRESS),
				completed: quotations.filter((quotation) => quotation?.status === OrderStatus.COMPLETED),
				cancelled: quotations.filter((quotation) => quotation?.status === OrderStatus.CANCELLED),
				postponed: quotations.filter((quotation) => quotation?.status === OrderStatus.POSTPONED),
				rejected: quotations.filter((quotation) => quotation?.status === OrderStatus.REJECTED),
				approved: quotations.filter((quotation) => quotation?.status === OrderStatus.APPROVED),
			};

			// Calculate metrics with formatted currency
			const metrics = {
				totalQuotations: quotations?.length,
				grossQuotationValue: this.formatCurrency(
					quotations?.reduce((sum, quotation) => sum + (Number(quotation?.totalAmount) || 0), 0),
				),
				averageQuotationValue: this.formatCurrency(
					quotations?.length > 0
						? quotations?.reduce((sum, quotation) => sum + (Number(quotation?.totalAmount) || 0), 0) /
								quotations?.length
						: 0,
				),
			};

			return {
				message: process.env.SUCCESS_MESSAGE,
				stats: {
					quotations: {
						...groupedQuotations,
						metrics,
					},
				},
			};
		} catch (error) {
			return {
				message: error?.message,
				stats: null,
			};
		}
	}

	private async ensureUniqueSKU(product: Product): Promise<string> {
		let sku = Product.generateSKU(product.category, product.name, product.uid, product.reseller);
		let counter = 1;

		while (await this.productRepository.findOne({ where: { sku } })) {
			sku = `${Product.generateSKU(product.category, product.name, product.uid, product.reseller)}-${counter}`;
			counter++;
		}

		return sku;
	}

	async createProduct(productData: CreateProductDto): Promise<Product> {
		let product = this.productRepository.create(productData);
		product = await this.productRepository.save(product);

		product.sku = await this.ensureUniqueSKU(product);
		return this.productRepository.save(product);
	}

	async updateQuotationStatus(
		quotationId: number,
		status: OrderStatus,
		orgId?: number,
		branchId?: number,
	): Promise<{ success: boolean; message: string }> {
		// Build query with org and branch filters
		const queryBuilder = this.quotationRepository
			.createQueryBuilder('quotation')
			.where('quotation.uid = :quotationId', { quotationId });

		if (orgId) {
			queryBuilder
				.leftJoinAndSelect('quotation.organisation', 'organisation')
				.andWhere('organisation.uid = :orgId', { orgId });
		}

		if (branchId) {
			queryBuilder
				.leftJoinAndSelect('quotation.branch', 'branch')
				.andWhere('branch.uid = :branchId', { branchId });
		}

		// Add relations
		queryBuilder
			.leftJoinAndSelect('quotation.quotationItems', 'quotationItems')
			.leftJoinAndSelect('quotationItems.product', 'product')
			.leftJoinAndSelect('quotation.client', 'client');

		const quotation = await queryBuilder.getOne();

		if (!quotation) {
			return {
				success: false,
				message: 'Quotation not found',
			};
		}

		const previousStatus = quotation.status;

		// Validate status transition
		if (!this.isValidStatusTransition(previousStatus, status)) {
			return {
				success: false,
				message: `Invalid status transition from ${previousStatus} to ${status}`,
			};
		}

		// Special handling for specific status transitions
		if (status === OrderStatus.APPROVED) {
			// Update product analytics when quotation is approved
			for (const item of quotation?.quotationItems) {
				// Calculate unit price from total price and quantity
				const unitPrice = item?.quantity > 0 ? Number(item?.totalPrice) / item?.quantity : Number(item?.totalPrice);
				await this.productsService?.recordSale(item?.product?.uid, item?.quantity, unitPrice);
				await this.productsService?.calculateProductPerformance(item?.product?.uid);
			}
		}

		// Update the quotation status
		await this.quotationRepository.update(quotationId, {
			status,
			updatedAt: new Date(),
		});

		// Only send notification if the status has changed
		if (previousStatus !== status) {
			try {
				// Prepare email data
				const emailData = {
					name: quotation.client?.name || quotation.client?.email?.split('@')[0] || 'Valued Customer',
					quotationId: quotation.quotationNumber,
					validUntil: quotation.validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now if not set
					total: Number(quotation.totalAmount),
					currency: this.currencyCode,
					status: status,
					quotationItems: quotation.quotationItems.map((item) => ({
						quantity: item.quantity,
						product: {
							uid: item.product.uid,
							name: item.product.name,
							code: item.product.sku || `SKU-${item.product.uid}`,
						},
						totalPrice: Number(item.totalPrice),
					})),
				};

				// Always notify internal team first
				const internalEmail = this.configService.get<string>('INTERNAL_BROADCAST_EMAIL');

				// Determine email type and message based on status
				let emailType = EmailType.QUOTATION_STATUS_UPDATE;
				let statusMessage = `updated to ${status}`;
				let clientNotification = true;

				// Status-specific email templates and messages
				switch (status) {
					case OrderStatus.DRAFT:
						emailType = EmailType.NEW_QUOTATION_INTERNAL;
						statusMessage = 'created as draft';
						clientNotification = false; // Don't notify client for draft status
						break;
					case OrderStatus.PENDING_INTERNAL:
						emailType = EmailType.QUOTATION_READY_FOR_REVIEW;
						statusMessage = 'ready for internal review';
						clientNotification = false;
						break;
					case OrderStatus.PENDING_CLIENT:
						emailType = EmailType.NEW_QUOTATION_CLIENT;
						statusMessage = 'sent to client for review';
						// Client notification handled separately below
						break;
					case OrderStatus.APPROVED:
						emailType = EmailType.QUOTATION_APPROVED;
						statusMessage = 'approved by client';
						break;
					case OrderStatus.REJECTED:
						emailType = EmailType.QUOTATION_REJECTED;
						statusMessage = 'rejected by client';
						break;
					case OrderStatus.SOURCING:
						emailType = EmailType.QUOTATION_SOURCING;
						statusMessage = 'being sourced';
						break;
					case OrderStatus.PACKING:
						emailType = EmailType.QUOTATION_PACKING;
						statusMessage = 'being packed';
						break;
					case OrderStatus.IN_FULFILLMENT:
						emailType = EmailType.QUOTATION_IN_FULFILLMENT;
						statusMessage = 'in fulfillment';
						break;
					case OrderStatus.PAID:
						emailType = EmailType.QUOTATION_PAID;
						statusMessage = 'marked as paid';
						break;
					case OrderStatus.OUTFORDELIVERY:
						emailType = EmailType.QUOTATION_SHIPPED;
						statusMessage = 'out for delivery';
						break;
					case OrderStatus.DELIVERED:
						emailType = EmailType.QUOTATION_DELIVERED;
						statusMessage = 'delivered';
						break;
					case OrderStatus.RETURNED:
						emailType = EmailType.QUOTATION_RETURNED;
						statusMessage = 'returned';
						break;
					case OrderStatus.COMPLETED:
						emailType = EmailType.QUOTATION_COMPLETED;
						statusMessage = 'completed';
						break;
					default:
						emailType = EmailType.QUOTATION_STATUS_UPDATE;
				}

				// Internal team notification
				this.eventEmitter.emit('send.email', emailType, [internalEmail], {
					...emailData,
					message: `Quotation ${quotation.quotationNumber} has been ${statusMessage}.`,
				});

				// Client notification for relevant statuses
				// Only send client notifications for statuses they need to know about
				const clientVisibleStatuses = [
					OrderStatus.PENDING_CLIENT,
					OrderStatus.APPROVED,
					OrderStatus.REJECTED,
					OrderStatus.SOURCING,
					OrderStatus.PACKING,
					OrderStatus.IN_FULFILLMENT,
					OrderStatus.PAID,
					OrderStatus.OUTFORDELIVERY,
					OrderStatus.DELIVERED,
					OrderStatus.RETURNED,
					OrderStatus.COMPLETED,
				];

				if (clientNotification && clientVisibleStatuses.includes(status) && quotation.client?.email) {
					// Special handling for PENDING_CLIENT status
					if (status === OrderStatus.PENDING_CLIENT) {
						// Include review URL for client review
						this.eventEmitter.emit('send.email', EmailType.NEW_QUOTATION_CLIENT, [quotation.client.email], {
							...emailData,
							reviewUrl: quotation.reviewUrl,
						});
					} else {
						// Standard notification for other statuses
						this.eventEmitter.emit('send.email', emailType, [quotation.client.email], emailData);
					}
				}

				// Also notify internal team about the status change via WebSocket
				// Get updated quotation with full data for WebSocket
				const updatedQuotationForSocket = await this.quotationRepository.findOne({
					where: { uid: quotationId },
					relations: ['client', 'placedBy', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
				});
				
				if (updatedQuotationForSocket) {
					this.shopGateway.notifyQuotationStatusChanged(updatedQuotationForSocket);
				}
			} catch (error) {
				this.logger.error('Failed to send quotation status update email:', error);
				// Continue with the process even if email sending fails
			}
		}

		return {
			success: true,
			message: `Quotation status updated to ${status}.`,
		};
	}

	// Helper method to validate status transitions
	private isValidStatusTransition(fromStatus: OrderStatus, toStatus: OrderStatus): boolean {
		// Define allowed transitions for each status
		const allowedTransitions = {
			[OrderStatus.DRAFT]: [OrderStatus.PENDING_INTERNAL, OrderStatus.PENDING_CLIENT, OrderStatus.CANCELLED],
			[OrderStatus.PENDING_INTERNAL]: [OrderStatus.PENDING_CLIENT, OrderStatus.DRAFT, OrderStatus.CANCELLED],
			[OrderStatus.PENDING_CLIENT]: [
				OrderStatus.APPROVED,
				OrderStatus.REJECTED,
				OrderStatus.NEGOTIATION,
				OrderStatus.PENDING_INTERNAL,
				OrderStatus.CANCELLED,
			],
			[OrderStatus.NEGOTIATION]: [
				OrderStatus.PENDING_INTERNAL,
				OrderStatus.PENDING_CLIENT,
				OrderStatus.APPROVED,
				OrderStatus.REJECTED,
				OrderStatus.CANCELLED,
			],
			[OrderStatus.APPROVED]: [
				OrderStatus.SOURCING,
				OrderStatus.PACKING,
				OrderStatus.IN_FULFILLMENT,
				OrderStatus.CANCELLED,
				OrderStatus.NEGOTIATION,
			],
			[OrderStatus.SOURCING]: [OrderStatus.PACKING, OrderStatus.IN_FULFILLMENT, OrderStatus.CANCELLED],
			[OrderStatus.PACKING]: [OrderStatus.IN_FULFILLMENT, OrderStatus.OUTFORDELIVERY, OrderStatus.CANCELLED],
			[OrderStatus.IN_FULFILLMENT]: [
				OrderStatus.PAID,
				OrderStatus.PACKING,
				OrderStatus.OUTFORDELIVERY,
				OrderStatus.CANCELLED,
			],
			[OrderStatus.PAID]: [
				OrderStatus.PACKING,
				OrderStatus.OUTFORDELIVERY,
				OrderStatus.DELIVERED,
				OrderStatus.CANCELLED,
			],
			[OrderStatus.OUTFORDELIVERY]: [OrderStatus.DELIVERED, OrderStatus.RETURNED, OrderStatus.CANCELLED],
			[OrderStatus.DELIVERED]: [OrderStatus.COMPLETED, OrderStatus.RETURNED, OrderStatus.CANCELLED],
			[OrderStatus.RETURNED]: [
				OrderStatus.COMPLETED,
				OrderStatus.CANCELLED,
				OrderStatus.SOURCING,
				OrderStatus.PACKING,
			],
			// Legacy statuses support - maintain backward compatibility
			[OrderStatus.PENDING]: [
				OrderStatus.INPROGRESS,
				OrderStatus.APPROVED,
				OrderStatus.REJECTED,
				OrderStatus.CANCELLED,
				OrderStatus.PENDING_INTERNAL,
				OrderStatus.PENDING_CLIENT,
			],
			[OrderStatus.INPROGRESS]: [
				OrderStatus.COMPLETED,
				OrderStatus.CANCELLED,
				OrderStatus.IN_FULFILLMENT,
				OrderStatus.SOURCING,
				OrderStatus.PACKING,
				OrderStatus.OUTFORDELIVERY,
				OrderStatus.DELIVERED,
			],
		};

		// Allow any transition for admin override (can be restricted based on roles later)
		// Check if the transition is allowed
		return allowedTransitions[fromStatus]?.includes(toStatus) || false;
	}

	async generateSKUsForExistingProducts(
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; updatedCount: number }> {
		try {
			// Build query with org and branch filters
			const queryBuilder = this.productRepository
				.createQueryBuilder('product')
				.where([{ sku: null }, { sku: '' }]);

			if (orgId) {
				queryBuilder.andWhere('product.organisationId = :orgId', { orgId });
			}

			if (branchId) {
				queryBuilder.andWhere('product.branchId = :branchId', { branchId });
			}

			const productsWithoutSKU = await queryBuilder.getMany();

			if (!productsWithoutSKU.length) {
				return {
					message: 'No products found requiring SKU generation',
					updatedCount: 0,
				};
			}

			const updatePromises = productsWithoutSKU.map(async (product) => {
				product.sku = await this.ensureUniqueSKU(product);
				return this.productRepository.save(product);
			});

			await Promise.all(updatePromises);

			return {
				message: `Successfully generated SKUs for ${productsWithoutSKU.length} products`,
				updatedCount: productsWithoutSKU.length,
			};
		} catch (error) {
			return {
				message: `Error generating SKUs: ${error.message}`,
				updatedCount: 0,
			};
		}
	}

	async regenerateAllSKUs(orgId?: number, branchId?: number): Promise<{ message: string; updatedCount: number }> {
		try {
			// Build query with org and branch filters
			const queryBuilder = this.productRepository.createQueryBuilder('product');

			if (orgId) {
				queryBuilder.andWhere('product.organisationId = :orgId', { orgId });
			}

			if (branchId) {
				queryBuilder.andWhere('product.branchId = :branchId', { branchId });
			}

			const allProducts = await queryBuilder.getMany();

			// Update each product with a new unique SKU
			const updatePromises = allProducts.map(async (product) => {
				product.sku = await this.ensureUniqueSKU(product);
				return this.productRepository.save(product);
			});

			await Promise.all(updatePromises);

			return {
				message: `Successfully regenerated SKUs for ${allProducts.length} products`,
				updatedCount: allProducts.length,
			};
		} catch (error) {
			return {
				message: `Error regenerating SKUs: ${error.message}`,
				updatedCount: 0,
			};
		}
	}

	async getQuotationsReport(filter: any, orgId?: number, branchId?: number) {
		try {
			// Add org and branch filters if provided
			if (orgId) {
				filter = { ...filter, 'organisation.uid': orgId };
			}

			if (branchId) {
				filter = { ...filter, 'branch.uid': branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: filter,
				relations: ['placedBy', 'client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
			});

			if (!quotations) {
				throw new NotFoundException('No quotations found for the specified period');
			}

			const groupedQuotations = {
				pending: quotations.filter((quotation) => quotation.status === OrderStatus.PENDING),
				approved: quotations.filter((quotation) => quotation.status === OrderStatus.APPROVED),
				rejected: quotations.filter((quotation) => quotation.status === OrderStatus.REJECTED),
			};

			const totalQuotations = quotations.length;
			const totalValue = quotations.reduce((sum, quotation) => sum + Number(quotation.totalAmount), 0);
			const approvedQuotations = groupedQuotations.approved.length;

			// Analyze products
			const productStats = this.analyzeProducts(quotations);
			const orderTimeAnalysis = this.analyzeOrderTimes(quotations);
			const shopAnalysis = this.analyzeShops(quotations);
			const basketAnalysis = this.analyzeBaskets(quotations);

			return {
				...groupedQuotations,
				total: totalQuotations,
				metrics: {
					totalQuotations,
					grossQuotationValue: this.formatCurrency(totalValue),
					averageQuotationValue: this.formatCurrency(totalQuotations > 0 ? totalValue / totalQuotations : 0),
					conversionRate: `${((approvedQuotations / totalQuotations) * 100).toFixed(1)}%`,
					topProducts: productStats.topProducts,
					leastSoldProducts: productStats.leastSoldProducts,
					peakOrderTimes: orderTimeAnalysis,
					averageBasketSize: basketAnalysis.averageSize,
					topShops: shopAnalysis,
				},
			};
		} catch (error) {
			return null;
		}
	}

	private analyzeProducts(quotations: Quotation[]): {
		topProducts: Array<{
			productId: number;
			productName: string;
			totalSold: number;
			totalValue: string;
		}>;
		leastSoldProducts: Array<{
			productId: number;
			productName: string;
			totalSold: number;
			lastSoldDate: Date;
		}>;
	} {
		const productStats = new Map<
			number,
			{
				name: string;
				totalSold: number;
				totalValue: number;
				lastSoldDate: Date;
			}
		>();

		quotations.forEach((quotation) => {
			quotation.quotationItems?.forEach((item) => {
				if (!productStats.has(item.product.uid)) {
					productStats.set(item.product.uid, {
						name: item.product.name,
						totalSold: 0,
						totalValue: 0,
						lastSoldDate: quotation.createdAt,
					});
				}

				const stats = productStats.get(item.product.uid);
				stats.totalSold += item.quantity;
				stats.totalValue += Number(item.totalPrice);
				if (quotation.createdAt > stats.lastSoldDate) {
					stats.lastSoldDate = quotation.createdAt;
				}
			});
		});

		const sortedProducts = Array.from(productStats.entries()).map(([productId, stats]) => ({
			productId,
			productName: stats.name,
			totalSold: stats.totalSold,
			totalValue: this.formatCurrency(stats.totalValue),
			lastSoldDate: stats.lastSoldDate,
		}));

		return {
			topProducts: [...sortedProducts].sort((a, b) => b.totalSold - a.totalSold).slice(0, 10),
			leastSoldProducts: [...sortedProducts].sort((a, b) => a.totalSold - b.totalSold).slice(0, 10),
		};
	}

	private analyzeOrderTimes(quotations: Quotation[]): Array<{
		hour: number;
		count: number;
		percentage: string;
	}> {
		const hourCounts = new Array(24).fill(0);

		quotations.forEach((quotation) => {
			const hour = quotation.createdAt.getHours();
			hourCounts[hour]++;
		});

		return hourCounts
			.map((count, hour) => ({
				hour,
				count,
				percentage: `${((count / quotations.length) * 100).toFixed(1)}%`,
			}))
			.sort((a, b) => b.count - a.count);
	}

	private analyzeShops(quotations: Quotation[]): Array<{
		shopId: number;
		shopName: string;
		totalOrders: number;
		totalValue: string;
		averageOrderValue: string;
	}> {
		const shopStats = new Map<
			number,
			{
				name: string;
				orders: number;
				totalValue: number;
			}
		>();

		quotations.forEach((quotation) => {
			const shopId = quotation.placedBy?.branch?.uid;
			const shopName = quotation.placedBy?.branch?.name;

			if (shopId && shopName) {
				if (!shopStats.has(shopId)) {
					shopStats.set(shopId, {
						name: shopName,
						orders: 0,
						totalValue: 0,
					});
				}

				const stats = shopStats.get(shopId);
				stats.orders++;
				stats.totalValue += Number(quotation.totalAmount);
			}
		});

		return Array.from(shopStats.entries())
			.map(([shopId, stats]) => ({
				shopId,
				shopName: stats.name,
				totalOrders: stats.orders,
				totalValue: this.formatCurrency(stats.totalValue),
				averageOrderValue: this.formatCurrency(stats.totalValue / stats.orders),
			}))
			.sort((a, b) => b.totalOrders - a.totalOrders);
	}

	private analyzeBaskets(quotations: Quotation[]): {
		averageSize: number;
		sizeDistribution: Record<string, number>;
	} {
		const basketSizes = quotations.map((quotation) => quotation.quotationItems?.length || 0);

		const totalItems = basketSizes.reduce((sum, size) => sum + size, 0);
		const averageSize = totalItems / quotations.length;

		const sizeDistribution = basketSizes.reduce((acc, size) => {
			const range = this.getBasketSizeRange(size);
			acc[range] = (acc[range] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		return {
			averageSize: Number(averageSize.toFixed(1)),
			sizeDistribution,
		};
	}

	private getBasketSizeRange(size: number): string {
		if (size === 1) return '1 item';
		if (size <= 3) return '2-3 items';
		if (size <= 5) return '4-5 items';
		if (size <= 10) return '6-10 items';
		return '10+ items';
	}

	async findAll(
		filters?: {
			status?: OrderStatus;
			clientId?: number;
			startDate?: Date;
			endDate?: Date;
			search?: string;
			orgId?: number;
			branchId?: number;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
	): Promise<PaginatedResponse<Quotation>> {
		const skip = (page - 1) * limit;

		// Build the query
		const queryBuilder = this.quotationRepository
			.createQueryBuilder('quotation')
			.leftJoinAndSelect('quotation.placedBy', 'placedBy')
			.leftJoinAndSelect('quotation.client', 'client')
			.leftJoinAndSelect('quotation.quotationItems', 'quotationItems')
			.leftJoinAndSelect('quotationItems.product', 'product');

		// Apply filters
		if (filters?.status) {
			queryBuilder.andWhere('quotation.status = :status', { status: filters.status });
		}

		if (filters?.clientId) {
			queryBuilder.andWhere('client.uid = :clientId', { clientId: filters.clientId });
		}

		if (filters?.startDate && filters?.endDate) {
			queryBuilder.andWhere('quotation.quotationDate BETWEEN :startDate AND :endDate', {
				startDate: startOfDay(filters.startDate),
				endDate: endOfDay(filters.endDate),
			});
		}

		if (filters?.search) {
			queryBuilder.andWhere(
				'(client.name LIKE :search OR placedBy.name LIKE :search OR quotation.quotationNumber LIKE :search)',
				{ search: `%${filters.search}%` },
			);
		}

		// Add org and branch filters
		if (filters?.orgId) {
			queryBuilder
				.leftJoinAndSelect('quotation.organisation', 'organisation')
				.andWhere('organisation.uid = :orgId', { orgId: filters.orgId });
		}

		if (filters?.branchId) {
			queryBuilder
				.leftJoinAndSelect('quotation.branch', 'branch')
				.andWhere('branch.uid = :branchId', { branchId: filters.branchId });
		}

		// Count total records
		const total = await queryBuilder.getCount();

		// Get paginated results
		const quotations = await queryBuilder
			.orderBy('quotation.quotationDate', 'DESC')
			.skip(skip)
			.take(limit)
			.getMany();

		// Calculate total pages
		const totalPages = Math.ceil(total / limit);

		return {
			data: quotations,
			meta: {
				total,
				page,
				limit,
				totalPages,
			},
			message: process.env.SUCCESS_MESSAGE,
		};
	}

	async validateReviewToken(token: string): Promise<{ valid: boolean; quotation?: Quotation; message: string }> {
		try {
			// Find quotation by token
			const quotation = await this.quotationRepository.findOne({
				where: { reviewToken: token },
				relations: ['client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
			});

			if (!quotation) {
				return {
					valid: false,
					message: 'Invalid token. No quotation found with this token.',
				};
			}

			// Check if the quotation is in a state that allows client review
			const allowedReviewStatuses = [
				OrderStatus.PENDING_CLIENT,
				OrderStatus.NEGOTIATION,
				OrderStatus.PENDING, // Legacy status
			];

			if (!allowedReviewStatuses.includes(quotation.status)) {
				// If already processed
				if (
					[
						OrderStatus.COMPLETED,
						OrderStatus.REJECTED,
						OrderStatus.CANCELLED,
						OrderStatus.APPROVED,
						OrderStatus.IN_FULFILLMENT,
						OrderStatus.DELIVERED,
						OrderStatus.PAID,
					].includes(quotation.status)
				) {
					return {
						valid: false,
						message: `This quotation has already been ${quotation.status}.`,
					};
				}

				// For other statuses
				return {
					valid: false,
					message: `This quotation is not available for review. Current status: ${quotation.status}.`,
				};
			}

			// Check token expiry based on the validUntil date of the quotation
			const now = new Date();
			if (quotation.validUntil && now > quotation.validUntil) {
				return {
					valid: false,
					message: 'This quotation has expired. Please contact us for a new quotation.',
				};
			}

			// If all checks pass, return the quotation
			return {
				valid: true,
				quotation,
				message: 'Token is valid',
			};
		} catch (error) {
			this.logger.error(`Error validating review token: ${error.message}`, error.stack);
			return {
				valid: false,
				message: 'An error occurred while validating the token.',
			};
		}
	}

	async updateQuotationStatusByToken(
		token: string,
		status: OrderStatus,
		comments?: string,
	): Promise<{ success: boolean; message: string }> {
		try {
			// Only allow APPROVED, REJECTED, or NEGOTIATION statuses from client review
			if (![OrderStatus.APPROVED, OrderStatus.REJECTED, OrderStatus.NEGOTIATION].includes(status)) {
				return {
					success: false,
					message: 'Invalid status. Only APPROVED, REJECTED, or NEGOTIATION are allowed.',
				};
			}

			// Validate the token first
			const tokenValidation = await this.validateReviewToken(token);
			if (!tokenValidation.valid || !tokenValidation.quotation) {
				return {
					success: false,
					message: tokenValidation.message,
				};
			}

			const quotation = tokenValidation.quotation;

			// Add comments if provided
			if (comments) {
				await this.quotationRepository.update(quotation.uid, {
					status,
					notes: quotation.notes
						? `${quotation.notes}\n\nClient feedback: ${comments}`
						: `Client feedback: ${comments}`,
					updatedAt: new Date(),
				});
			} else {
				await this.quotationRepository.update(quotation.uid, {
					status,
					updatedAt: new Date(),
				});
			}

			// Send notification emails
			try {
				// Get the updated quotation with all relations
				const updatedQuotation = await this.quotationRepository.findOne({
					where: { uid: quotation.uid },
					relations: ['client', 'quotationItems', 'quotationItems.product'],
				});

				if (updatedQuotation && updatedQuotation.client?.email) {
					// Special handling for approved status - update product metrics
					if (status === OrderStatus.APPROVED) {
						for (const item of updatedQuotation.quotationItems) {
							if (item.product && item.product.uid) {
								// Calculate unit price from total price and quantity
								const unitPrice = item.quantity > 0 ? Number(item.totalPrice) / item.quantity : Number(item.totalPrice);
								await this.productsService.recordSale(
									item.product.uid,
									item.quantity,
									unitPrice,
								);
								await this.productsService.calculateProductPerformance(item.product.uid);
							}
						}
					}

					// Prepare email data
					const emailData = {
						name: updatedQuotation.client.name || updatedQuotation.client.email.split('@')[0],
						quotationId: updatedQuotation.quotationNumber,
						validUntil: updatedQuotation.validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
						total: Number(updatedQuotation.totalAmount),
						currency: this.currencyCode,
						status: status,
						quotationItems: updatedQuotation.quotationItems.map((item) => ({
							quantity: item.quantity,
							product: {
								uid: item.product.uid,
								name: item.product.name,
								code: item.product.sku || `SKU-${item.product.uid}`,
							},
							totalPrice: Number(item.totalPrice),
						})),
					};

					// Determine which email template to use based on status
					let emailType = EmailType.QUOTATION_STATUS_UPDATE;

					switch (status) {
						case OrderStatus.APPROVED:
							emailType = EmailType.QUOTATION_APPROVED;
							break;
						case OrderStatus.REJECTED:
							emailType = EmailType.QUOTATION_REJECTED;
							break;
					}

					// Emit event for email sending
					this.eventEmitter.emit('send.email', emailType, [updatedQuotation.client.email], emailData);

					// Also notify internal team about the status change
					this.shopGateway.notifyQuotationStatusChanged(updatedQuotation);
				}
			} catch (error) {
				// Log but don't fail if emails fail
				this.logger.error(`Failed to send quotation status update email: ${error.message}`, error.stack);
			}

			// Determine appropriate success message
			let successMsg: string;
			if (status === OrderStatus.APPROVED) {
				successMsg = 'Quotation has been approved successfully.';
			} else if (status === OrderStatus.REJECTED) {
				successMsg = 'Quotation has been rejected.';
			} else if (status === OrderStatus.NEGOTIATION) {
				successMsg = 'Feedback submitted. Our team will review your comments and get back to you shortly.';
			} else {
				successMsg = `Quotation status has been updated to ${status}.`;
			}

			return {
				success: true,
				message: successMsg,
			};
		} catch (error) {
			this.logger.error(`Error updating quotation status by token: ${error.message}`, error.stack);
			return {
				success: false,
				message: 'An error occurred while updating the quotation status.',
			};
		}
	}

	async sendQuotationToClient(
		quotationId: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ success: boolean; message: string }> {
		try {
			// Find the quotation with all relations
			const queryBuilder = this.quotationRepository
				.createQueryBuilder('quotation')
				.where('quotation.uid = :quotationId', { quotationId });

			if (orgId) {
				queryBuilder
					.leftJoinAndSelect('quotation.organisation', 'organisation')
					.andWhere('organisation.uid = :orgId', { orgId });
			}

			if (branchId) {
				queryBuilder
					.leftJoinAndSelect('quotation.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			// Add relations
			queryBuilder
				.leftJoinAndSelect('quotation.quotationItems', 'quotationItems')
				.leftJoinAndSelect('quotationItems.product', 'product')
				.leftJoinAndSelect('quotation.client', 'client');

			const quotation = await queryBuilder.getOne();

			if (!quotation) {
				return {
					success: false,
					message: 'Quotation not found',
				};
			}

			// Validate the current status
			if (quotation.status !== OrderStatus.PENDING_INTERNAL && quotation.status !== OrderStatus.DRAFT) {
				return {
					success: false,
					message: `Cannot send quotation to client. Current status is ${quotation.status}.`,
				};
			}

			// Update quotation status to PENDING_CLIENT
			await this.quotationRepository.update(quotationId, {
				status: OrderStatus.PENDING_CLIENT,
				updatedAt: new Date(),
			});

			// Get updated quotation
			const updatedQuotation = await queryBuilder.getOne();

			if (!updatedQuotation || !updatedQuotation.client?.email) {
				return {
					success: false,
					message: 'Failed to update quotation or client email not found',
				};
			}

			// If the quotation doesn't have a PDF URL, generate one now
			if (!updatedQuotation.pdfURL) {
				const pdfUrl = await this.generateQuotationPDF(updatedQuotation);

				// If PDF was generated successfully, update the quotation record
				if (pdfUrl) {
					await this.quotationRepository.update(quotationId, { pdfURL: pdfUrl });
					updatedQuotation.pdfURL = pdfUrl;
				}
			}

			// Prepare email data
			const emailData = {
				name: updatedQuotation.client.name || updatedQuotation.client.email.split('@')[0],
				quotationId: updatedQuotation.quotationNumber,
				validUntil: updatedQuotation.validUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
				total: Number(updatedQuotation.totalAmount),
				currency: this.currencyCode,
				reviewUrl: updatedQuotation.reviewUrl,
				quotationItems: updatedQuotation.quotationItems.map((item) => ({
					quantity: item.quantity,
					product: {
						uid: item.product.uid,
						name: item.product.name,
						code: item.product.sku || `SKU-${item.product.uid}`,
					},
					totalPrice: Number(item.totalPrice),
				})),
				// Add the PDF URL to the email data
				pdfURL: updatedQuotation.pdfURL,
			};

			// Now send the full quotation to the client
			this.eventEmitter.emit(
				'send.email',
				EmailType.NEW_QUOTATION_CLIENT,
				[updatedQuotation.client.email],
				emailData,
			);

			// Notify internal team that quotation was sent to client
			const internalEmail = this.configService.get<string>('INTERNAL_BROADCAST_EMAIL');
			this.eventEmitter.emit('send.email', EmailType.QUOTATION_STATUS_UPDATE, [internalEmail], {
				...emailData,
				message: `Quotation ${updatedQuotation.quotationNumber} has been sent to the client for review.`,
			});

			// Emit WebSocket event
			this.shopGateway.notifyQuotationStatusChanged(updatedQuotation);

			return {
				success: true,
				message: 'Quotation has been sent to the client for review.',
			};
		} catch (error) {
			this.logger.error(`Error sending quotation to client: ${error.message}`, error.stack);
			return {
				success: false,
				message: 'An error occurred while sending the quotation to client.',
			};
		}
	}

	/**
	 * Generate a PDF for the quotation and store the URL
	 */
	private async generateQuotationPDF(quotation: Quotation): Promise<string | null> {
		const startTime = Date.now();
		this.logger.log(`[generateQuotationPDF] Starting PDF generation for quotation ${quotation?.quotationNumber || 'UNKNOWN'}`);

		try {
			// Comprehensive validation with detailed logging
			if (!quotation) {
				this.logger.error('[generateQuotationPDF] Quotation object is null or undefined');
				throw new Error('Quotation object is required for PDF generation');
			}

			if (!quotation.quotationItems || !Array.isArray(quotation.quotationItems) || quotation.quotationItems.length === 0) {
				this.logger.error(`[generateQuotationPDF] Invalid quotation items for quotation ${quotation.quotationNumber}: items=${quotation.quotationItems?.length || 0}`);
				throw new Error('Quotation must have at least one item for PDF generation');
			}

			if (!quotation.client) {
				this.logger.error(`[generateQuotationPDF] No client data for quotation ${quotation.quotationNumber}`);
				throw new Error('Client information is required for PDF generation');
			}

			this.logger.log(`[generateQuotationPDF] Quotation validation passed - Items: ${quotation.quotationItems.length}, Client: ${quotation.client.name || 'UNKNOWN'}`);

			// Get org currency with enhanced fallback and logging
			let orgCurrency;
			try {
				orgCurrency = quotation.organisation?.uid
					? await this.getOrgCurrency(quotation.organisation.uid)
					: { 
						code: this.currencyCode || 'ZAR', 
						symbol: this.currencySymbol || 'R', 
						locale: this.currencyLocale || 'en-ZA' 
					};
				
				this.logger.log(`[generateQuotationPDF] Currency settings - Code: ${orgCurrency.code}, Symbol: ${orgCurrency.symbol}`);
			} catch (currencyError) {
				this.logger.warn(`[generateQuotationPDF] Failed to get org currency, using defaults: ${currencyError.message}`);
				orgCurrency = { 
					code: this.currencyCode || 'ZAR', 
					symbol: this.currencySymbol || 'R', 
					locale: this.currencyLocale || 'en-ZA' 
				};
			}

			// Format client billing address with enhanced validation and logging
			let clientBillingAddress = '';
			try {
				if (quotation.client?.address) {
					const addressObj = quotation.client.address as any;
					if (typeof addressObj === 'object' && addressObj !== null) {
						const parts = [
							addressObj?.street,
							addressObj?.suburb,
							addressObj?.city,
							addressObj?.state,
							addressObj?.country,
							addressObj?.postalCode,
						].filter(part => part && typeof part === 'string' && part.trim() !== '');
						clientBillingAddress = parts.join(', ');
						this.logger.log(`[generateQuotationPDF] Client address formatted: ${clientBillingAddress.length} characters`);
					} else if (typeof addressObj === 'string' && addressObj.trim() !== '') {
						clientBillingAddress = addressObj.trim();
						this.logger.log(`[generateQuotationPDF] Client address (string): ${clientBillingAddress.length} characters`);
					}
				}
				
				if (!clientBillingAddress) {
					this.logger.warn(`[generateQuotationPDF] No valid client address found for quotation ${quotation.quotationNumber}`);
					clientBillingAddress = 'Address not provided';
				}
			} catch (addressError) {
				this.logger.warn(`[generateQuotationPDF] Error processing client address: ${addressError.message}`);
				clientBillingAddress = 'Address not available';
			}

			// Enhanced company address processing with fallbacks and logging
			let companyAddressLines: string[] = [];
			try {
				if (quotation.organisation?.address) {
					const orgAddr = quotation.organisation.address as any;
					if (typeof orgAddr === 'object' && orgAddr !== null) {
						const addressParts = [
							orgAddr?.street,
							orgAddr?.suburb,
							orgAddr?.city && orgAddr?.postalCode ? `${orgAddr.city}, ${orgAddr.postalCode}`.trim() : orgAddr?.city,
							orgAddr?.state,
							orgAddr?.country,
						].filter(part => part && typeof part === 'string' && part.trim() !== '');
						companyAddressLines = addressParts;
						this.logger.log(`[generateQuotationPDF] Company address processed: ${companyAddressLines.length} lines`);
					}
				}
				
				if (companyAddressLines.length === 0) {
					this.logger.warn(`[generateQuotationPDF] No company address found, using default`);
					companyAddressLines = ['Address not provided'];
				}
			} catch (companyAddressError) {
				this.logger.warn(`[generateQuotationPDF] Error processing company address: ${companyAddressError.message}`);
				companyAddressLines = ['Address not available'];
			}

			// Enhanced quotation items processing with comprehensive validation
			const validatedItems = [];
			let invalidItemsCount = 0;

			for (let i = 0; i < quotation.quotationItems.length; i++) {
				const item = quotation.quotationItems[i];
				
				try {
					// Use item?.property pattern for safe access
					if (!item?.product) {
						this.logger.warn(`[generateQuotationPDF] Item ${i} has no product data, skipping`);
						invalidItemsCount++;
						continue;
					}

					const quantity = Number(item?.quantity) || 1;
					const totalPrice = Number(item?.totalPrice) || 0;
					const unitPrice = quantity > 0 ? totalPrice / quantity : totalPrice;

					// Comprehensive item validation
					const validatedItem = {
						itemCode: item?.product?.productRef || item?.product?.sku || `ITEM-${item?.product?.uid || i + 1}`,
						description: item?.product?.name || 'Product name not available',
						quantity: quantity,
						unitPrice: unitPrice,
					};

					// Additional validation
					if (quantity <= 0) {
						this.logger.warn(`[generateQuotationPDF] Item ${i} has invalid quantity (${quantity}), using fallback`);
						validatedItem.quantity = 1;
					}

					if (unitPrice < 0) {
						this.logger.warn(`[generateQuotationPDF] Item ${i} has negative unit price (${unitPrice}), using 0`);
						validatedItem.unitPrice = 0;
					}

					validatedItems.push(validatedItem);
					this.logger.debug(`[generateQuotationPDF] Item ${i} validated: ${validatedItem.description} (${validatedItem.quantity} x ${validatedItem.unitPrice})`);

				} catch (itemError) {
					this.logger.error(`[generateQuotationPDF] Error processing item ${i}: ${itemError.message}`);
					invalidItemsCount++;
					
					// Add fallback item to prevent empty PDF
					validatedItems.push({
						itemCode: `ITEM-${i + 1}`,
						description: 'Product information unavailable',
						quantity: 1,
						unitPrice: 0,
					});
				}
			}

			if (invalidItemsCount > 0) {
				this.logger.warn(`[generateQuotationPDF] ${invalidItemsCount} items had issues and were processed with fallbacks`);
			}

			if (validatedItems.length === 0) {
				this.logger.error(`[generateQuotationPDF] No valid items found for quotation ${quotation.quotationNumber}`);
				throw new Error('No valid items found for PDF generation');
			}

			// Enhanced financial calculations with validation
			const totalAmount = Number(quotation.totalAmount) || 0;
			const subtotal = totalAmount * 0.85; // Assuming 15% tax rate
			const tax = totalAmount * 0.15;

			this.logger.log(`[generateQuotationPDF] Financial calculations - Total: ${totalAmount}, Subtotal: ${subtotal}, Tax: ${tax}`);

			// Prepare comprehensive PDF data with all fallbacks
			const pdfData: QuotationTemplateData = {
				companyDetails: {
					name: quotation.organisation?.name || 'Loro',
					addressLines: companyAddressLines,
					phone: quotation.organisation?.phone || '',
					email: quotation.organisation?.email || '',
					website: quotation.organisation?.website || '',
					logoPath: quotation.organisation?.logo || '',
				},
				quotationId: quotation.quotationNumber || `QUO-${Date.now()}`,
				date: quotation.quotationDate || new Date(),
				validUntil: quotation.validUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
				client: {
					name: quotation.client?.name || 'Client name not provided',
					email: quotation.client?.email || '',
					phone: quotation.client?.phone || '',
					address: clientBillingAddress,
					deliveryAddress: undefined, // TODO: Add when delivery address is available on client entity
				},
				items: validatedItems,
				subtotal: subtotal,
				tax: tax,
				total: totalAmount,
				currency: orgCurrency.code,
				terms: 'Payment due within 30 days. Please contact us for any questions or concerns.',
			};

			this.logger.log(`[generateQuotationPDF] PDF data prepared successfully - Items: ${validatedItems.length}, Currency: ${orgCurrency.code}`);

			// Generate the PDF with enhanced error handling
			let result;
			try {
				result = await this.pdfGenerationService.create({
					template: 'quotation',
					data: pdfData,
				});
			} catch (pdfError) {
				this.logger.error(`[generateQuotationPDF] PDF generation failed: ${pdfError.message}`, pdfError.stack);
				throw new Error(`PDF generation failed: ${pdfError.message}`);
			}

			if (!result?.success) {
				this.logger.error(`[generateQuotationPDF] PDF generation returned unsuccessful result: ${result?.message || 'Unknown error'}`);
				throw new Error(`PDF generation failed: ${result?.message || 'Unknown error'}`);
			}

			const generationTime = Date.now() - startTime;
			this.logger.log(`[generateQuotationPDF] PDF generated successfully in ${generationTime}ms - URL: ${result.url}`);

			return result.url;

		} catch (error) {
			const generationTime = Date.now() - startTime;
			this.logger.error(`[generateQuotationPDF] PDF generation failed after ${generationTime}ms for quotation ${quotation?.quotationNumber || 'UNKNOWN'}: ${error.message}`, error.stack);
			return null;
		}
	}
}
