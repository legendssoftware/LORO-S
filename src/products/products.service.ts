import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';
import { Repository } from 'typeorm';
import { ProductStatus } from '../lib/enums/product.enums';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductAnalytics } from './entities/product-analytics.entity';
import { ProductAnalyticsDto } from './dto/product-analytics.dto';
import { BulkCreateProductDto, BulkCreateProductResponse, BulkProductResult } from './dto/bulk-create-product.dto';
import { BulkUpdateProductDto, BulkUpdateProductResponse, BulkUpdateProductResult } from './dto/bulk-update-product.dto';
import { DataSource } from 'typeorm';

@Injectable()
export class ProductsService {
	private readonly CACHE_PREFIX = 'products:';
	private readonly CACHE_TTL: number;
	private readonly logger = new Logger(ProductsService.name);

	constructor(
		@InjectRepository(Product)
		private readonly productRepository: Repository<Product>,
		@InjectRepository(ProductAnalytics)
		private readonly analyticsRepository: Repository<ProductAnalytics>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly eventEmitter: EventEmitter2,
		private readonly dataSource: DataSource,
	) {
		this.CACHE_TTL = Number(process.env.CACHE_EXPIRATION_TIME) || 30;
	}

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	private async invalidateProductCache(product: Product) {
		try {
			// Get all cache keys
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// Add product-specific keys
			keysToDelete.push(this.getCacheKey(product.uid), `${this.CACHE_PREFIX}all`, `${this.CACHE_PREFIX}stats`);

			// Add category-specific keys
			if (product.category) {
				keysToDelete.push(`${this.CACHE_PREFIX}category_${product.category}`);
			}

			// Add status-specific keys
			if (product.status) {
				keysToDelete.push(`${this.CACHE_PREFIX}status_${product.status}`);
			}

			// Add organization-specific keys
			if (product.organisation?.uid) {
				keysToDelete.push(`${this.CACHE_PREFIX}org_${product.organisation.uid}`);
			}

			// Add branch-specific keys
			if (product.branch?.uid) {
				keysToDelete.push(`${this.CACHE_PREFIX}branch_${product.branch.uid}`);
			}

			// Clear all pagination and search caches
			const productListCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}page`) ||
					key.startsWith(`${this.CACHE_PREFIX}search`) ||
					key.includes('_limit'),
			);
			keysToDelete.push(...productListCaches);

			// Clear all caches
			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));

			// Emit event for other services that might be caching product data
			this.eventEmitter.emit('products.cache.invalidate', {
				productId: product.uid,
				keys: keysToDelete,
			});
		} catch (error) {
			this.logger.error(`❌ [invalidateProductCache] Error invalidating product cache: ${error.message}`, error.stack);
		}
	}

	/**
	 * 🗑️ Invalidate caches for multiple products efficiently
	 * @param products - Array of products to invalidate caches for
	 */
	private async invalidateBulkProductCaches(products: Product[]): Promise<void> {
		try {
			if (!products || products.length === 0) return;


			// Get all cache keys
			const keys = await this.cacheManager.store.keys();
			const keysToDelete = new Set<string>();

			// Add general cache keys
			keysToDelete.add(`${this.CACHE_PREFIX}all`);
			keysToDelete.add(`${this.CACHE_PREFIX}stats`);

			// Collect all unique categories, statuses, orgs, and branches
			const categories = new Set<string>();
			const statuses = new Set<string>();
			const orgIds = new Set<number>();
			const branchIds = new Set<number>();

			products.forEach(product => {
				// Add product-specific keys
				keysToDelete.add(this.getCacheKey(product.uid));

				// Collect unique values for batch invalidation
				if (product.category) categories.add(product.category);
				if (product.status) statuses.add(product.status);
				if (product.organisation?.uid) orgIds.add(product.organisation.uid);
				if (product.branch?.uid) branchIds.add(product.branch.uid);
			});

			// Add category-specific keys
			categories.forEach(category => {
				keysToDelete.add(`${this.CACHE_PREFIX}category_${category}`);
			});

			// Add status-specific keys
			statuses.forEach(status => {
				keysToDelete.add(`${this.CACHE_PREFIX}status_${status}`);
			});

			// Add organization-specific keys
			orgIds.forEach(orgId => {
				keysToDelete.add(`${this.CACHE_PREFIX}org_${orgId}`);
			});

			// Add branch-specific keys
			branchIds.forEach(branchId => {
				keysToDelete.add(`${this.CACHE_PREFIX}branch_${branchId}`);
			});

			// Clear all pagination and search caches
			const productListCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}page`) ||
					key.startsWith(`${this.CACHE_PREFIX}search`) ||
					key.includes('_limit'),
			);
			productListCaches.forEach(key => keysToDelete.add(key));

			// Clear all caches in parallel
			const keysArray = Array.from(keysToDelete);
			await Promise.all(keysArray.map((key) => this.cacheManager.del(key)));


			// Emit event for other services that might be caching product data
			this.eventEmitter.emit('products.cache.bulk.invalidate', {
				productIds: products.map(p => p.uid),
				keys: keysArray,
				timestamp: new Date(),
			});
		} catch (error) {
			this.logger.error(`❌ [invalidateBulkProductCaches] Error invalidating bulk product caches: ${error.message}`, error.stack);
		}
	}

	/**
	 * 📦 Create a new product in the system
	 * @param createProductDto - Product data transfer object
	 * @param orgId - Organization ID (optional)
	 * @param branchId - Branch ID (optional)
	 * @returns Promise with created product or error message
	 */
	async createProduct(
		createProductDto: CreateProductDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ product: Product | null; message: string }> {
		this.logger.log(`🚀 [createProduct] Creating new product: ${createProductDto.name} for orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			
			// Create product with org and branch
			const product = this.productRepository.create({
				...createProductDto,
				...(orgId && { organisation: { uid: orgId } }),
				...(branchId && { branch: { uid: branchId } }),
			});

			const savedProduct = await this.productRepository.save(product);

			this.logger.log(`✅ [createProduct] Product created successfully with ID: ${savedProduct.uid}`);

			// Clear cache
			await this.cacheManager.del(`${this.CACHE_PREFIX}all`);

			this.logger.log(`🎉 [createProduct] Product creation completed: ${savedProduct.name} (ID: ${savedProduct.uid})`);

			// Return the saved product
			return {
				product: savedProduct,
				message: process.env.SUCCESS_MESSAGE || 'Product created successfully',
			};
		} catch (error) {
			this.logger.error(`❌ [createProduct] Error creating product: ${error.message}`, error.stack);
			return {
				product: null,
				message: error.message || 'Error creating product',
			};
		}
	}

	/**
	 * 📦 Create multiple products in bulk with transaction support
	 * @param bulkCreateProductDto - Bulk product creation data
	 * @returns Promise with bulk creation results
	 */
	async createBulkProducts(bulkCreateProductDto: BulkCreateProductDto): Promise<BulkCreateProductResponse> {
		const startTime = Date.now();
		this.logger.log(`📦 [createBulkProducts] Starting bulk creation of ${bulkCreateProductDto.products.length} products`);
		
		const results: BulkProductResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		const errors: string[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkCreateProductDto.products.length; i++) {
				const productData = bulkCreateProductDto.products[i];
				
				try {
					
					// Create product with org and branch association
					const product = queryRunner.manager.create(Product, {
						...productData,
						...(bulkCreateProductDto.orgId && { organisation: { uid: bulkCreateProductDto.orgId } }),
						...(bulkCreateProductDto.branchId && { branch: { uid: bulkCreateProductDto.branchId } }),
					});

					const savedProduct = await queryRunner.manager.save(Product, product);
					
					// Create analytics record for the product
					const analytics = queryRunner.manager.create(ProductAnalytics, {
						productId: savedProduct.uid,
						totalUnitsSold: 0,
						totalRevenue: 0,
						salesCount: 0,
						viewCount: 0,
						cartAddCount: 0,
						wishlistCount: 0,
						quotationCount: 0,
						quotationToOrderCount: 0,
						conversionRate: 0,
						stockHistory: [],
						salesHistory: [],
						priceHistory: []
					});
					
					await queryRunner.manager.save(ProductAnalytics, analytics);

					results.push({
						product: savedProduct,
						success: true,
						index: i,
						sku: productData.sku,
						name: productData.name
					});
					
					successCount++;
					
				} catch (productError) {
					const errorMessage = `Product ${i + 1} (${productData.name || productData.sku}): ${productError.message}`;
					this.logger.error(`❌ [createBulkProducts] ${errorMessage}`, productError.stack);
					
					results.push({
						product: null,
						success: false,
						error: productError.message,
						index: i,
						sku: productData.sku,
						name: productData.name
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [createBulkProducts] Transaction committed - ${successCount} products created successfully`);
				
				// Comprehensive cache invalidation after successful bulk creation
				await this.invalidateBulkProductCaches(results.filter(r => r.success).map(r => r.product));
				
				// Emit bulk creation event
				this.eventEmitter.emit('products.bulk.created', {
					totalRequested: bulkCreateProductDto.products.length,
					totalCreated: successCount,
					totalFailed: failureCount,
					orgId: bulkCreateProductDto.orgId,
					branchId: bulkCreateProductDto.branchId,
					timestamp: new Date(),
				});
			} else {
				// Rollback if no products were created successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [createBulkProducts] Transaction rolled back - no products were created successfully`);
			}

		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(`❌ [createBulkProducts] Transaction error: ${transactionError.message}`, transactionError.stack);
			
			return {
				totalRequested: bulkCreateProductDto.products.length,
				totalCreated: 0,
				totalFailed: bulkCreateProductDto.products.length,
				successRate: 0,
				results: [],
				message: `Bulk creation failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkCreateProductDto.products.length) * 100;

		this.logger.log(`🎉 [createBulkProducts] Bulk creation completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%`);

		return {
			totalRequested: bulkCreateProductDto.products.length,
			totalCreated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk creation completed: ${successCount} products created, ${failureCount} failed`
				: 'Bulk creation failed: No products were created',
			errors: errors.length > 0 ? errors : undefined,
			duration
		};
	}

	/**
	 * 📝 Update an existing product
	 * @param ref - Product reference ID
	 * @param updateProductDto - Updated product data
	 * @returns Promise with success message or error
	 */
	async updateProduct(ref: number, updateProductDto: UpdateProductDto): Promise<{ message: string }> {
		this.logger.log(`🔄 [updateProduct] Updating product ID: ${ref}`);
		
		try {
			
			// First find the product to ensure it exists
			this.logger.debug(`🔍 [updateProduct] Finding product with ID: ${ref}`);
			const product = await this.getProductByref(ref);

			if (!product.product) {
				this.logger.warn(`⚠️ [updateProduct] Product not found with ID: ${ref}`);
				throw new NotFoundException('Product not found');
			}

			this.logger.log(`✅ [updateProduct] Product found: ${product.product.name} (ID: ${ref})`);

			// Check if price is being updated to update price history
			if (updateProductDto.price && updateProductDto.price !== product.product.price) {
				this.logger.log(`💰 [updateProduct] Price change detected: ${product.product.price} → ${updateProductDto.price}`);
				await this.updatePriceHistory(ref, updateProductDto.price, 'update');
			}

			// Check if stock quantity is being updated to update stock history
			if (
				updateProductDto.stockQuantity !== undefined &&
				updateProductDto.stockQuantity !== product.product.stockQuantity
			) {
				const stockChange = updateProductDto.stockQuantity - (product.product.stockQuantity || 0);
				this.logger.log(`📦 [updateProduct] Stock change detected: ${product.product.stockQuantity} → ${updateProductDto.stockQuantity} (${stockChange > 0 ? '+' : ''}${stockChange})`);
				await this.updateStockHistory(ref, Math.abs(stockChange), stockChange > 0 ? 'in' : 'out');
			}

			// Ensure productRef exists for existing products
			if (!product.product.productRef) {
				this.logger.debug(`🏷️ [updateProduct] Generating missing productRef for product ID: ${ref}`);
				updateProductDto.productRef = `PRD${Math.floor(100000 + Math.random() * 900000)}`;
			}

			// Update the product
			this.logger.debug(`💾 [updateProduct] Applying updates to database`);
			await this.productRepository.update(ref, updateProductDto);

			// Invalidate cache
			this.logger.debug(`🗑️ [updateProduct] Invalidating product cache`);
			await this.invalidateProductCache(product.product);

			this.logger.log(`🎉 [updateProduct] Product updated successfully: ${product.product.name} (ID: ${ref})`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`❌ [updateProduct] Error updating product ID ${ref}: ${error.message}`, error.stack);
			return {
				message: error.message || 'Error updating product',
			};
		}
	}

	/**
	 * 📝 Update multiple products in bulk with transaction support
	 * @param bulkUpdateProductDto - Bulk product update data
	 * @returns Promise with bulk update results
	 */
	async updateBulkProducts(bulkUpdateProductDto: BulkUpdateProductDto): Promise<BulkUpdateProductResponse> {
		const startTime = Date.now();
		this.logger.log(`📝 [updateBulkProducts] Starting bulk update of ${bulkUpdateProductDto.updates.length} products`);
		
		const results: BulkUpdateProductResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		const errors: string[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkUpdateProductDto.updates.length; i++) {
				const updateItem = bulkUpdateProductDto.updates[i];
				const { ref, data } = updateItem;
				
				try {
					this.logger.debug(`📝 [updateBulkProducts] Processing product ${i + 1}/${bulkUpdateProductDto.updates.length}: ID ${ref}`);
					
					// First find the product to ensure it exists
					const existingProduct = await queryRunner.manager.findOne(Product, { 
						where: { uid: ref, isDeleted: false } 
					});

					if (!existingProduct) {
						throw new NotFoundException(`Product with ID ${ref} not found`);
					}

					this.logger.debug(`✅ [updateBulkProducts] Product found: ${existingProduct.name} (ID: ${ref})`);

					// Track changed fields for logging
					const updatedFields = Object.keys(data).filter(key => 
						data[key] !== undefined && data[key] !== existingProduct[key]
					);

					// Check if price is being updated to update price history
					if (data.price && data.price !== existingProduct.price) {
						this.logger.debug(`💰 [updateBulkProducts] Price change detected for product ${ref}: ${existingProduct.price} → ${data.price}`);
						
						// Find analytics and update price history
						const analytics = await queryRunner.manager.findOne(ProductAnalytics, { 
							where: { productId: ref } 
						});
						
						if (analytics) {
							const priceHistory = analytics.priceHistory || [];
							priceHistory.push({
								date: new Date(),
								price: data.price,
								type: 'bulk_update',
							});
							
							await queryRunner.manager.update(ProductAnalytics, 
								{ productId: ref }, 
								{ priceHistory }
							);
						}
					}

					// Check if stock quantity is being updated to update stock history
					if (data.stockQuantity !== undefined && data.stockQuantity !== existingProduct.stockQuantity) {
						const stockChange = data.stockQuantity - (existingProduct.stockQuantity || 0);
						this.logger.debug(`📦 [updateBulkProducts] Stock change detected for product ${ref}: ${existingProduct.stockQuantity} → ${data.stockQuantity} (${stockChange > 0 ? '+' : ''}${stockChange})`);
						
						// Find analytics and update stock history
						const analytics = await queryRunner.manager.findOne(ProductAnalytics, { 
							where: { productId: ref } 
						});
						
						if (analytics) {
							const stockHistory = analytics.stockHistory || [];
							stockHistory.push({
								date: new Date(),
								quantity: Math.abs(stockChange),
								type: stockChange > 0 ? 'in' : 'out',
								balance: data.stockQuantity,
							});
							
							await queryRunner.manager.update(ProductAnalytics, 
								{ productId: ref }, 
								{ stockHistory }
							);
						}
					}

					// Ensure productRef exists for existing products
					if (!existingProduct.productRef && !data.productRef) {
						this.logger.debug(`🏷️ [updateBulkProducts] Generating missing productRef for product ID: ${ref}`);
						data.productRef = `PRD${Math.floor(100000 + Math.random() * 900000)}`;
					}

					// Update the product
					await queryRunner.manager.update(Product, ref, data);

					results.push({
						ref,
						success: true,
						index: i,
						name: existingProduct.name,
						updatedFields
					});
					
					successCount++;
					this.logger.debug(`✅ [updateBulkProducts] Product ${i + 1} updated successfully: ${existingProduct.name} (ID: ${ref})`);
					
				} catch (productError) {
					const errorMessage = `Product ID ${ref}: ${productError.message}`;
					this.logger.error(`❌ [updateBulkProducts] ${errorMessage}`, productError.stack);
					
					results.push({
						ref,
						success: false,
						error: productError.message,
						index: i
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [updateBulkProducts] Transaction committed - ${successCount} products updated successfully`);
				
				// Comprehensive cache invalidation after successful bulk update
				this.logger.debug(`🗑️ [updateBulkProducts] Invalidating comprehensive product caches`);
				const successfulUpdates = results.filter(r => r.success);
				
				// Get the updated products for comprehensive cache invalidation
				const updatedProducts = await Promise.all(
					successfulUpdates.map(result => 
						this.productRepository.findOne({ where: { uid: result.ref }, relations: ['organisation', 'branch'] })
					)
				);
				await this.invalidateBulkProductCaches(updatedProducts.filter(p => p !== null));
				
				// Emit bulk update event
				this.eventEmitter.emit('products.bulk.updated', {
					totalRequested: bulkUpdateProductDto.updates.length,
					totalUpdated: successCount,
					totalFailed: failureCount,
					updatedProductIds: successfulUpdates.map(r => r.ref),
					timestamp: new Date(),
				});
			} else {
				// Rollback if no products were updated successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [updateBulkProducts] Transaction rolled back - no products were updated successfully`);
			}

		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(`❌ [updateBulkProducts] Transaction error: ${transactionError.message}`, transactionError.stack);
			
			return {
				totalRequested: bulkUpdateProductDto.updates.length,
				totalUpdated: 0,
				totalFailed: bulkUpdateProductDto.updates.length,
				successRate: 0,
				results: [],
				message: `Bulk update failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkUpdateProductDto.updates.length) * 100;

		this.logger.log(`🎉 [updateBulkProducts] Bulk update completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%`);

		return {
			totalRequested: bulkUpdateProductDto.updates.length,
			totalUpdated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk update completed: ${successCount} products updated, ${failureCount} failed`
				: 'Bulk update failed: No products were updated',
			errors: errors.length > 0 ? errors : undefined,
			duration
		};
	}

	/**
	 * 🗑️ Soft delete a product (marks as deleted)
	 * @param ref - Product reference ID
	 * @returns Promise with success message or error
	 */
	async deleteProduct(ref: number): Promise<{ message: string }> {
		this.logger.log(`🗑️ [deleteProduct] Soft deleting product ID: ${ref}`);
		
		try {
			// First find the product to ensure it exists
			this.logger.debug(`🔍 [deleteProduct] Finding product with ID: ${ref}`);
			const product = await this.getProductByref(ref);

			if (!product.product) {
				this.logger.warn(`⚠️ [deleteProduct] Product not found with ID: ${ref}`);
				throw new NotFoundException('Product not found');
			}

			this.logger.log(`✅ [deleteProduct] Product found: ${product.product.name} (ID: ${ref})`);

			// Soft delete
			this.logger.debug(`🔄 [deleteProduct] Marking product as deleted and inactive`);
			await this.productRepository.update(ref, {
				isDeleted: true,
				status: ProductStatus.INACTIVE,
			});

			// Invalidate cache
			this.logger.debug(`🗑️ [deleteProduct] Invalidating product cache`);
			await this.invalidateProductCache(product.product);

			this.logger.log(`🎉 [deleteProduct] Product successfully deleted: ${product.product.name} (ID: ${ref})`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`❌ [deleteProduct] Error deleting product ID ${ref}: ${error.message}`, error.stack);
			return {
				message: error.message || 'Error deleting product',
			};
		}
	}

	/**
	 * 🔄 Restore a soft-deleted product (marks as active)
	 * @param ref - Product reference ID
	 * @returns Promise with success message or error
	 */
	async restoreProduct(ref: number): Promise<{ message: string }> {
		this.logger.log(`🔄 [restoreProduct] Restoring deleted product ID: ${ref}`);
		
		try {
			// Find the deleted product using queryBuilder to avoid column errors
			this.logger.debug(`🔍 [restoreProduct] Searching for deleted product with ID: ${ref}`);
			const product = await this.productRepository
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
					'product.isDeleted',
				])
				.leftJoin('product.organisation', 'organisation')
				.leftJoin('product.branch', 'branch')
				.where('product.uid = :uid', { uid: ref })
				.andWhere('product.isDeleted = :isDeleted', { isDeleted: true })
				.getOne();

			if (!product) {
				this.logger.warn(`⚠️ [restoreProduct] Deleted product not found with ID: ${ref}`);
				throw new NotFoundException('Product not found');
			}

			this.logger.log(`✅ [restoreProduct] Deleted product found: ${product.name} (ID: ${ref})`);

			// Restore the product
			this.logger.debug(`🔄 [restoreProduct] Marking product as active and not deleted`);
			await this.productRepository.update(ref, {
				isDeleted: false,
				status: ProductStatus.ACTIVE,
			});

			// Invalidate cache
			this.logger.debug(`🗑️ [restoreProduct] Invalidating product cache`);
			await this.invalidateProductCache(product);

			this.logger.log(`🎉 [restoreProduct] Product successfully restored: ${product.name} (ID: ${ref})`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`❌ [restoreProduct] Error restoring product ID ${ref}: ${error.message}`, error.stack);
			return {
				message: error.message || 'Error restoring product',
			};
		}
	}

	/**
	 * 📃 Get paginated list of products
	 * @param page - Page number (default: 1)
	 * @param limit - Items per page (default: env.DEFAULT_PAGE_LIMIT)
	 * @param orgId - Organization ID filter (REQUIRED - all products must belong to an org)
	 * @param branchId - Branch ID filter (optional)
	 * @returns Promise with paginated product data
	 * 
	 * BRANCH VISIBILITY LOGIC:
	 * - Products WITHOUT a branch assigned (branchUid IS NULL) are visible to ALL users in the organization
	 * - Products WITH a branch assigned (branchUid IS NOT NULL) are ONLY visible to users from that specific branch
	 * - This ensures org-wide products are accessible to everyone, while branch-specific products remain restricted
	 */
	async products(
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Product>> {
		this.logger.log(`📃 [products] Fetching products - page: ${page}, limit: ${limit}, orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			// Only select fields that exist in the database to avoid column errors
			this.logger.debug(`🔍 [products] Building query with filters`);
			const queryBuilder = this.productRepository
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
					'product.isDeleted',
				])
				.leftJoin('product.organisation', 'organisation')
				.leftJoin('product.branch', 'branch')
				.leftJoin('product.analytics', 'analytics')
				.where('product.isDeleted = :isDeleted', { isDeleted: false });

			// Filter by organization - REQUIRED to ensure products belong to the org
			if (orgId) {
				this.logger.debug(`🏢 [products] Filtering by organization ID: ${orgId}`);
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// BRANCH VISIBILITY LOGIC:
			// - If branchId is provided: show products where branch is NULL (org-wide) OR matches the branchId
			// - If branchId is NOT provided: show all products in the org (both with and without branches)
			if (branchId) {
				this.logger.debug(`🏪 [products] Filtering by branch ID: ${branchId} - showing org-wide products (no branch) and branch-specific products`);
				queryBuilder.andWhere('(branch.uid IS NULL OR branch.uid = :branchId)', { branchId });
			}

			// Add pagination
			this.logger.debug(`📄 [products] Applying pagination - skip: ${(page - 1) * limit}, take: ${limit}`);
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('product.createdAt', 'DESC');

			this.logger.debug(`🔍 [products] Executing query to get products and count`);
			const [products, total] = await queryBuilder.getManyAndCount();

			if (!products || products.length === 0) {
				this.logger.warn(`⚠️ [products] No products found for current filters`);
				return {
					data: [],
					meta: {
						total: 0,
						page,
						limit,
						totalPages: 0,
					},
					message: 'No products found',
				};
			}

			this.logger.log(`✅ [products] Successfully fetched ${products.length} products out of ${total} total`);

			return {
				data: products,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`❌ [products] Error fetching products: ${error.message}`, error.stack);
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error.message || 'Error fetching products',
			};
		}
	}

	/**
	 * 🔍 Get a specific product by reference ID
	 * @param ref - Product reference ID
	 * @param orgId - Organization ID filter (REQUIRED)
	 * @param branchId - Branch ID filter (optional)
	 * @param userId - User ID for analytics tracking (optional)
	 * @returns Promise with product data or null
	 * 
	 * BRANCH VISIBILITY LOGIC:
	 * - Products WITHOUT a branch assigned (branchUid IS NULL) are visible to ALL users in the organization
	 * - Products WITH a branch assigned (branchUid IS NOT NULL) are ONLY visible to users from that specific branch
	 */
	async getProductByref(
		ref: number,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ product: Product | null; message: string }> {
		this.logger.log(`🔍 [getProductByref] Fetching product ID: ${ref}, orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			// Use queryBuilder to only select existing columns
			this.logger.debug(`🔍 [getProductByref] Building query for product ID: ${ref}`);
			const queryBuilder = this.productRepository
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
					'product.isDeleted',
				])
				.leftJoin('product.organisation', 'organisation')
				.leftJoin('product.branch', 'branch')
				.leftJoin('product.analytics', 'analytics')
				.leftJoin('product.reseller', 'reseller')
				.where('product.uid = :uid', { uid: ref })
				.andWhere('product.isDeleted = :isDeleted', { isDeleted: false });

			// Add org filter if provided
			if (orgId) {
				this.logger.debug(`🏢 [getProductByref] Adding organization filter: ${orgId}`);
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// BRANCH VISIBILITY LOGIC:
			// - If branchId is provided: show products where branch is NULL (org-wide) OR matches the branchId
			// - If branchId is NOT provided: show all products in the org (both with and without branches)
			if (branchId) {
				this.logger.debug(`🏪 [getProductByref] Adding branch filter: ${branchId} - showing org-wide products (no branch) and branch-specific products`);
				queryBuilder.andWhere('(branch.uid IS NULL OR branch.uid = :branchId)', { branchId });
			}

			this.logger.debug(`🔍 [getProductByref] Executing query for product ID: ${ref}`);
			const product = await queryBuilder.getOne();

			if (!product) {
				this.logger.warn(`⚠️ [getProductByref] Product not found with ID: ${ref}`);
				throw new NotFoundException('Product not found');
			}

			this.logger.log(`✅ [getProductByref] Product found: ${product.name} (ID: ${ref})`);

			// Emit product view event for analytics tracking
			if (userId) {
				this.eventEmitter.emit('product.viewed', {
					productId: ref,
					userId,
					orgId,
					branchId,
					productName: product.name,
					category: product.category,
					timestamp: new Date(),
				});
			}

			return {
				product,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`❌ [getProductByref] Error fetching product ID ${ref}: ${error.message}`, error.stack);
			return {
				product: null,
				message: error.message || 'Error fetching product',
			};
		}
	}

	/**
	 * 🔍 Search products by term across multiple fields
	 * @param searchTerm - Search term to match against product fields
	 * @param page - Page number (default: 1)
	 * @param limit - Items per page (default: 10)
	 * @param orgId - Organization ID filter (REQUIRED)
	 * @param branchId - Branch ID filter (optional)
	 * @returns Promise with paginated search results
	 * 
	 * BRANCH VISIBILITY LOGIC:
	 * - Products WITHOUT a branch assigned (branchUid IS NULL) are visible to ALL users in the organization
	 * - Products WITH a branch assigned (branchUid IS NOT NULL) are ONLY visible to users from that specific branch
	 */
	async productsBySearchTerm(
		searchTerm: string,
		page: number = 1,
		limit: number = 10,
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Product>> {
		this.logger.log(`🔍 [productsBySearchTerm] Searching products with term: "${searchTerm}", page: ${page}, limit: ${limit}, orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			// Only select fields that exist in the database to avoid column errors
			this.logger.debug(`🔍 [productsBySearchTerm] Building search query for term: "${searchTerm}"`);
			const queryBuilder = this.productRepository
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
					'product.isDeleted',
				])
				.leftJoin('product.organisation', 'organisation')
				.leftJoin('product.branch', 'branch')
				.where('product.isDeleted = :isDeleted', { isDeleted: false });

			// Filter by organization if provided
			if (orgId) {
				this.logger.debug(`🏢 [productsBySearchTerm] Adding organization filter: ${orgId}`);
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// BRANCH VISIBILITY LOGIC:
			// - If branchId is provided: show products where branch is NULL (org-wide) OR matches the branchId
			// - If branchId is NOT provided: show all products in the org (both with and without branches)
			if (branchId) {
				this.logger.debug(`🏪 [productsBySearchTerm] Adding branch filter: ${branchId} - showing org-wide products (no branch) and branch-specific products`);
				queryBuilder.andWhere('(branch.uid IS NULL OR branch.uid = :branchId)', { branchId });
			}

			// Apply search term - could be category, name, or description
			this.logger.debug(`🔎 [productsBySearchTerm] Applying search filters for: name, description, category, sku, barcode`);
			queryBuilder.andWhere(
				'(LOWER(product.category) LIKE LOWER(:searchTerm) OR LOWER(product.name) LIKE LOWER(:searchTerm) OR LOWER(product.description) LIKE LOWER(:searchTerm) OR LOWER(product.sku) LIKE LOWER(:searchTerm) OR LOWER(product.barcode) LIKE LOWER(:searchTerm))',
				{ searchTerm: `%${searchTerm}%` },
			);

			// Add pagination
			this.logger.debug(`📄 [productsBySearchTerm] Applying pagination - skip: ${(page - 1) * limit}, take: ${limit}`);
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('product.createdAt', 'DESC');

			this.logger.debug(`🔍 [productsBySearchTerm] Executing search query`);
			const [products, total] = await queryBuilder.getManyAndCount();

			if (!products || products.length === 0) {
				this.logger.warn(`⚠️ [productsBySearchTerm] No products found matching search term: "${searchTerm}"`);
				return {
					data: [],
					meta: {
						total: 0,
						page,
						limit,
						totalPages: 0,
					},
					message: 'No products found matching search criteria',
				};
			}

			this.logger.log(`✅ [productsBySearchTerm] Found ${products.length} products out of ${total} total matching "${searchTerm}"`);

			return {
				data: products,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`❌ [productsBySearchTerm] Error searching products with term "${searchTerm}": ${error.message}`, error.stack);
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error.message || 'Error searching products',
			};
		}
	}

	/**
	 * 📂 Get products by category with advanced filtering and sorting
	 * @param category - Product category to filter by
	 * @param page - Page number (default: 1)
	 * @param limit - Items per page (default: 20)
	 * @param search - Additional search term (optional)
	 * @param orgId - Organization ID filter (REQUIRED)
	 * @param branchId - Branch ID filter (optional)
	 * @returns Promise with paginated category products
	 * 
	 * BRANCH VISIBILITY LOGIC:
	 * - Products WITHOUT a branch assigned (branchUid IS NULL) are visible to ALL users in the organization
	 * - Products WITH a branch assigned (branchUid IS NOT NULL) are ONLY visible to users from that specific branch
	 */
	async productsByCategory(
		category: string,
		page: number = 1,
		limit: number = 20,
		search: string = '',
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Product>> {
		this.logger.log(`📂 [productsByCategory] Fetching products by category: "${category}", page: ${page}, limit: ${limit}, search: "${search}", orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			// Only select fields that exist in the database to avoid column errors
			this.logger.debug(`🔍 [productsByCategory] Building category query for: "${category}"`);
			const queryBuilder = this.productRepository
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
					'product.isDeleted',
				])
				.leftJoin('product.organisation', 'organisation')
				.leftJoin('product.branch', 'branch')
				.where('product.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('product.status != :inactive', { inactive: ProductStatus.INACTIVE });

			// Filter by organization if provided
			if (orgId) {
				this.logger.debug(`🏢 [productsByCategory] Adding organization filter: ${orgId}`);
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// BRANCH VISIBILITY LOGIC:
			// - If branchId is provided: show products where branch is NULL (org-wide) OR matches the branchId
			// - If branchId is NOT provided: show all products in the org (both with and without branches)
			if (branchId) {
				this.logger.debug(`🏪 [productsByCategory] Adding branch filter: ${branchId} - showing org-wide products (no branch) and branch-specific products`);
				queryBuilder.andWhere('(branch.uid IS NULL OR branch.uid = :branchId)', { branchId });
			}

			// Filter by category (exact match or partial match)
			this.logger.debug(`📂 [productsByCategory] Adding category filter: "${category}"`);
			queryBuilder.andWhere('LOWER(product.category) LIKE LOWER(:category)', {
				category: `%${category}%`,
			});

			// Apply additional search term if provided
			if (search && search.trim()) {
				this.logger.debug(`🔎 [productsByCategory] Adding additional search term: "${search}"`);
				queryBuilder.andWhere(
					'(LOWER(product.name) LIKE LOWER(:search) OR LOWER(product.description) LIKE LOWER(:search) OR LOWER(product.sku) LIKE LOWER(:search) OR LOWER(product.barcode) LIKE LOWER(:search) OR LOWER(product.brand) LIKE LOWER(:search))',
					{ search: `%${search.trim()}%` },
				);
			}

			// Add pagination and ordering
			this.logger.debug(`📄 [productsByCategory] Applying pagination and sorting - skip: ${(page - 1) * limit}, take: ${limit}`);
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('product.isOnPromotion', 'DESC') // Show promoted products first
				.addOrderBy('product.stockQuantity', 'DESC') // Show in-stock products first
				.addOrderBy('product.createdAt', 'DESC'); // Then by newest

			this.logger.debug(`🔍 [productsByCategory] Executing category query`);
			const [products, total] = await queryBuilder.getManyAndCount();

			if (!products || products.length === 0) {
				this.logger.warn(`⚠️ [productsByCategory] No products found in category: "${category}"`);
			} else {
				this.logger.log(`✅ [productsByCategory] Found ${products.length} products out of ${total} total in category: "${category}"`);
			}

			return {
				data: products,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: products.length > 0 ? process.env.SUCCESS_MESSAGE : 'No products found in this category',
			};
		} catch (error) {
			this.logger.error(`❌ [productsByCategory] Error fetching products by category "${category}": ${error.message}`, error.stack);
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error.message || 'Error fetching products by category',
			};
		}
	}

	// Analytics methods don't need org/branch filtering since they operate on products
	// that have already been filtered by the getProductByref method

	/**
	 * 📊 Update product analytics data
	 * @param productId - Product ID
	 * @param updateData - Partial analytics data to update
	 * @returns Promise with success message or error
	 */
	async updateProductAnalytics(productId: number, updateData: Partial<ProductAnalyticsDto>) {
		this.logger.log(`📊 [updateProductAnalytics] Updating analytics for product ID: ${productId}`);
		
		try {
			this.logger.debug(`🔍 [updateProductAnalytics] Finding analytics for product ID: ${productId}`);
			const analytics = await this.analyticsRepository.findOne({ where: { productId } });
			
			if (!analytics) {
				this.logger.warn(`⚠️ [updateProductAnalytics] Product analytics not found for ID: ${productId}`);
				throw new NotFoundException('Product analytics not found');
			}

			this.logger.debug(`📝 [updateProductAnalytics] Updating analytics data: ${JSON.stringify(updateData)}`);
			await this.analyticsRepository.update({ productId }, updateData);
			
			this.logger.log(`✅ [updateProductAnalytics] Analytics updated successfully for product ID: ${productId}`);
			return { message: 'Analytics updated successfully' };
		} catch (error) {
			this.logger.error(`❌ [updateProductAnalytics] Error updating analytics for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error updating analytics' };
		}
	}

	/**
	 * 📈 Get product analytics data
	 * @param productId - Product ID
	 * @returns Promise with analytics data or null
	 */
	async getProductAnalytics(productId: number) {
		this.logger.log(`📈 [getProductAnalytics] Fetching analytics for product ID: ${productId}`);
		
		try {
			this.logger.debug(`🔍 [getProductAnalytics] Searching for analytics for product ID: ${productId}`);
			const analytics = await this.analyticsRepository.findOne({ where: { productId } });
			
			if (!analytics) {
				this.logger.warn(`⚠️ [getProductAnalytics] Analytics not found for product ID: ${productId}`);
				return { message: 'Analytics not found', analytics: null };
			}
			
			this.logger.log(`✅ [getProductAnalytics] Analytics found for product ID: ${productId}`);
			return { message: 'Success', analytics };
		} catch (error) {
			this.logger.error(`❌ [getProductAnalytics] Error fetching analytics for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error fetching analytics', analytics: null };
		}
	}

	/**
	 * 💰 Update product price history
	 * @param productId - Product ID
	 * @param newPrice - New price to record
	 * @param type - Type of price change (e.g., 'update', 'promotion', 'discount')
	 * @returns Promise with success message or error
	 */
	async updatePriceHistory(productId: number, newPrice: number, type: string) {
		this.logger.log(`💰 [updatePriceHistory] Updating price history for product ID: ${productId}, newPrice: ${newPrice}, type: ${type}`);
		
		try {
			this.logger.debug(`🔍 [updatePriceHistory] Finding analytics for product ID: ${productId}`);
			const analytics = await this.analyticsRepository.findOne({ where: { productId } });
			
			if (!analytics) {
				this.logger.warn(`⚠️ [updatePriceHistory] Product analytics not found for ID: ${productId}`);
				throw new NotFoundException('Product analytics not found');
			}

			this.logger.debug(`📝 [updatePriceHistory] Adding price entry to history: ${newPrice} (${type})`);
			const priceHistory = analytics.priceHistory || [];
			priceHistory.push({
				date: new Date(),
				price: newPrice,
				type,
			});

			this.logger.debug(`💾 [updatePriceHistory] Updating price history in database`);
			await this.analyticsRepository.update({ productId }, { priceHistory });
			
			this.logger.log(`✅ [updatePriceHistory] Price history updated successfully for product ID: ${productId}`);
			return { message: 'Price history updated successfully' };
		} catch (error) {
			this.logger.error(`❌ [updatePriceHistory] Error updating price history for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error updating price history' };
		}
	}

	/**
	 * 🛒 Record a product sale and update analytics
	 * @param productId - Product ID
	 * @param quantity - Quantity sold
	 * @param salePrice - Sale price per unit
	 * @param orderId - Order/Quotation ID for tracking (optional)
	 * @param orgId - Organization ID (optional)
	 * @param branchId - Branch ID (optional)
	 * @returns Promise with success message or error
	 */
	async recordSale(
		productId: number, 
		quantity: number, 
		salePrice: number,
		orderId?: string,
		orgId?: number,
		branchId?: number
	) {
		this.logger.log(`🛒 [recordSale] Recording sale for product ID: ${productId}, quantity: ${quantity}, salePrice: ${salePrice}`);
		
		try {
			this.logger.debug(`🔍 [recordSale] Finding analytics for product ID: ${productId}`);
			const analytics = await this.analyticsRepository.findOne({ where: { productId } });
			
			if (!analytics) {
				this.logger.warn(`⚠️ [recordSale] Product analytics not found for ID: ${productId}`);
				throw new NotFoundException('Product analytics not found');
			}

			// Get product details for event emission
			const productResult = await this.getProductByref(productId, orgId, branchId);
			const product = productResult.product;

			// Update sales metrics
			const totalSaleValue = quantity * salePrice;
			this.logger.debug(`📊 [recordSale] Calculating sales metrics - total sale value: ${totalSaleValue}`);
			
			const updatedAnalytics = {
				totalUnitsSold: (analytics.totalUnitsSold || 0) + quantity,
				totalRevenue: (analytics.totalRevenue || 0) + totalSaleValue,
				salesCount: (analytics.salesCount || 0) + 1,
				lastSaleDate: new Date(),
				salesHistory: [
					...(analytics.salesHistory || []),
					{
						date: new Date(),
						quantity,
						price: salePrice,
						total: totalSaleValue,
						orderId: orderId || `SALE-${Date.now()}`,
					},
				],
			};

			this.logger.debug(`📝 [recordSale] Updating analytics with new sales data`);
			await this.analyticsRepository.update({ productId }, updatedAnalytics);

			// Update stock history
			this.logger.debug(`📦 [recordSale] Updating stock history for outgoing stock: ${quantity} units`);
			await this.updateStockHistory(productId, quantity, 'out');

			// Emit real-time sale event for analytics
			this.eventEmitter.emit('product.sold', {
				productId,
				productName: product?.name || 'Unknown Product',
				category: product?.category || 'Unknown',
				quantity,
				amount: totalSaleValue,
				unitPrice: salePrice,
				orderId: orderId || `SALE-${Date.now()}`,
				orgId,
				branchId,
				timestamp: new Date(),
			});

			// Check for stock alerts after sale
			if (product && product.stockQuantity <= (product.reorderPoint || 10)) {
				this.eventEmitter.emit('inventory.low.stock', {
					productId,
					productName: product.name,
					currentStock: product.stockQuantity,
					reorderPoint: product.reorderPoint || 10,
					orgId,
					branchId,
					severity: product.stockQuantity <= 0 ? 'critical' : 'warning',
				});
			}

			this.logger.log(`✅ [recordSale] Sale recorded successfully for product ID: ${productId} - ${quantity} units at ${salePrice} each`);
			return { message: 'Sale recorded successfully' };
		} catch (error) {
			this.logger.error(`❌ [recordSale] Error recording sale for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error recording sale' };
		}
	}

	/**
	 * 📦 Record a product purchase and update analytics
	 * @param productId - Product ID
	 * @param quantity - Quantity purchased
	 * @param purchasePrice - Purchase price per unit
	 * @returns Promise with success message or error
	 */
	async recordPurchase(productId: number, quantity: number, purchasePrice: number) {
		this.logger.log(`📦 [recordPurchase] Recording purchase for product ID: ${productId}, quantity: ${quantity}, purchasePrice: ${purchasePrice}`);
		
		try {
			this.logger.debug(`🔍 [recordPurchase] Finding analytics for product ID: ${productId}`);
			const analytics = await this.analyticsRepository.findOne({ where: { productId } });
			
			if (!analytics) {
				this.logger.warn(`⚠️ [recordPurchase] Product analytics not found for ID: ${productId}`);
				throw new NotFoundException('Product analytics not found');
			}

			// Calculate total purchase cost
			const totalCost = quantity * purchasePrice;
			this.logger.debug(`📊 [recordPurchase] Calculating purchase metrics - total cost: ${totalCost}`);
			
			const newUnitsPurchased = (analytics.unitsPurchased || 0) + quantity;
			const newTotalPurchaseCost = (analytics.totalPurchaseCost || 0) + totalCost;
			const newAveragePurchasePrice = newTotalPurchaseCost / newUnitsPurchased;
			
			this.logger.debug(`📈 [recordPurchase] New metrics - units: ${newUnitsPurchased}, total cost: ${newTotalPurchaseCost}, avg price: ${newAveragePurchasePrice}`);

			// Update purchase metrics
			this.logger.debug(`📝 [recordPurchase] Updating analytics with purchase data`);
			await this.analyticsRepository.update(
				{ productId },
				{
					unitsPurchased: newUnitsPurchased,
					totalPurchaseCost: newTotalPurchaseCost,
					lastPurchaseDate: new Date(),
					averagePurchasePrice: newAveragePurchasePrice,
				},
			);

			// Update stock history
			this.logger.debug(`📦 [recordPurchase] Updating stock history for incoming stock: ${quantity} units`);
			await this.updateStockHistory(productId, quantity, 'in');

			this.logger.log(`✅ [recordPurchase] Purchase recorded successfully for product ID: ${productId} - ${quantity} units at ${purchasePrice} each`);
			return { message: 'Purchase recorded successfully' };
		} catch (error) {
			this.logger.error(`❌ [recordPurchase] Error recording purchase for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error recording purchase' };
		}
	}

	/**
	 * 👀 Record a product view event
	 * @param productId - Product ID
	 * @param userId - User ID (optional)
	 * @param orgId - Organization ID (optional)
	 * @param branchId - Branch ID (optional)
	 * @returns Promise with success message
	 */
	async recordView(productId: number, userId?: number, orgId?: number, branchId?: number) {
		this.logger.log(`👀 [recordView] Recording view for product ID: ${productId}, user: ${userId}`);
		
		try {
			let analytics = await this.analyticsRepository.findOne({ where: { productId } });
			if (!analytics) {
				this.logger.warn(`⚠️ [recordView] Analytics not found for product ID: ${productId}. Creating new analytics record.`);
				
				// Auto-create analytics for this product
				try {
					analytics = this.analyticsRepository.create({
						productId,
						totalUnitsSold: 0,
						totalRevenue: 0,
						salesCount: 0,
						viewCount: 0,
						cartAddCount: 0,
						wishlistCount: 0,
						quotationCount: 0,
						quotationToOrderCount: 0,
						conversionRate: 0,
						stockHistory: [],
						salesHistory: [],
						priceHistory: []
					});
					analytics = await this.analyticsRepository.save(analytics);
					this.logger.log(`✅ [recordView] Created new analytics record for product ID: ${productId}`);
				} catch (createError) {
					this.logger.error(`❌ [recordView] Failed to create analytics for product ID ${productId}: ${createError.message}`);
					return { message: 'Failed to create product analytics but view attempt recorded' };
				}
			}

			const newViewCount = (analytics.viewCount || 0) + 1;
			this.logger.debug(`📊 [recordView] Updating view count from ${analytics.viewCount || 0} to ${newViewCount}`);
			await this.analyticsRepository.update({ productId }, { 
				viewCount: newViewCount,
			});

			// Get product details for event
			const productResult = await this.getProductByref(productId, orgId, branchId);
			const product = productResult.product;

			// Emit view event for real-time analytics
			this.eventEmitter.emit('product.viewed', {
				productId,
				productName: product?.name || 'Unknown Product',
				category: product?.category || 'Unknown',
				userId,
				orgId,
				branchId,
				timestamp: new Date(),
			});

			this.logger.log(`✅ [recordView] View recorded successfully for product ID: ${productId}`);
			return { message: 'View recorded' };
		} catch (error) {
			this.logger.error(`❌ [recordView] Error recording view for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error recording view' };
		}
	}

	/**
	 * 🛒 Record a cart add event
	 * @param productId - Product ID
	 * @param quantity - Quantity added to cart (optional, defaults to 1)
	 * @param userId - User ID (optional)
	 * @param orgId - Organization ID (optional)
	 * @param branchId - Branch ID (optional)
	 * @returns Promise with success message
	 */
	async recordCartAdd(
		productId: number, 
		quantity: number = 1,
		userId?: number, 
		orgId?: number, 
		branchId?: number
	) {
		this.logger.log(`🛒 [recordCartAdd] Recording cart add for product ID: ${productId}, quantity: ${quantity}, user: ${userId}`);
		
		try {
			let analytics = await this.analyticsRepository.findOne({ where: { productId } });
			if (!analytics) {
				this.logger.warn(`⚠️ [recordCartAdd] Analytics not found for product ID: ${productId}. Creating new analytics record.`);
				
				// Auto-create analytics for this product
				try {
					analytics = this.analyticsRepository.create({
						productId,
						totalUnitsSold: 0,
						totalRevenue: 0,
						salesCount: 0,
						viewCount: 0,
						cartAddCount: 0,
						wishlistCount: 0,
						quotationCount: 0,
						quotationToOrderCount: 0,
						conversionRate: 0,
						stockHistory: [],
						salesHistory: [],
						priceHistory: []
					});
					analytics = await this.analyticsRepository.save(analytics);
					this.logger.log(`✅ [recordCartAdd] Created new analytics record for product ID: ${productId}`);
				} catch (createError) {
					this.logger.error(`❌ [recordCartAdd] Failed to create analytics for product ID ${productId}: ${createError.message}`);
					return { message: 'Failed to create product analytics but cart add attempt recorded' };
				}
			}

			const newCartAddCount = (analytics.cartAddCount || 0) + 1;
			this.logger.debug(`📊 [recordCartAdd] Updating cart add count from ${analytics.cartAddCount || 0} to ${newCartAddCount}`);
			await this.analyticsRepository.update({ productId }, { cartAddCount: newCartAddCount });

			// Get product details for event
			const productResult = await this.getProductByref(productId, orgId, branchId);
			const product = productResult.product;

			// Emit cart add event for real-time analytics
			this.eventEmitter.emit('product.cart.added', {
				productId,
				productName: product?.name || 'Unknown Product',
				category: product?.category || 'Unknown',
				quantity,
				userId,
				orgId,
				branchId,
				timestamp: new Date(),
			});

			this.logger.log(`✅ [recordCartAdd] Cart add recorded successfully for product ID: ${productId}`);
			return { message: 'Cart add recorded' };
		} catch (error) {
			this.logger.error(`❌ [recordCartAdd] Error recording cart add for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error recording cart add' };
		}
	}

	/**
	 * ⭐ Record a wishlist add event
	 * @param productId - Product ID
	 * @returns Promise with success message
	 */
	async recordWishlist(productId: number) {
		this.logger.log(`⭐ [recordWishlist] Recording wishlist add for product ID: ${productId}`);
		
		try {
		const analytics = await this.analyticsRepository.findOne({ where: { productId } });
		if (analytics) {
				const newWishlistCount = (analytics.wishlistCount || 0) + 1;
				this.logger.debug(`📊 [recordWishlist] Updating wishlist count from ${analytics.wishlistCount || 0} to ${newWishlistCount}`);
				await this.analyticsRepository.update({ productId }, { wishlistCount: newWishlistCount });
				this.logger.log(`✅ [recordWishlist] Wishlist add recorded successfully for product ID: ${productId}`);
			} else {
				this.logger.warn(`⚠️ [recordWishlist] Analytics not found for product ID: ${productId}`);
		}
		return { message: 'Wishlist add recorded' };
		} catch (error) {
			this.logger.error(`❌ [recordWishlist] Error recording wishlist add for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error recording wishlist add' };
		}
	}

	/**
	 * 📦 Update stock history for a product
	 * @param productId - Product ID
	 * @param quantity - Quantity moved
	 * @param type - Type of stock movement ('in' or 'out')
	 * @returns Promise with success message or error
	 */
	async updateStockHistory(productId: number, quantity: number, type: 'in' | 'out') {
		this.logger.log(`📦 [updateStockHistory] Updating stock history for product ID: ${productId}, quantity: ${quantity}, type: ${type}`);
		
		try {
			this.logger.debug(`🔍 [updateStockHistory] Finding analytics for product ID: ${productId}`);
			let analytics = await this.analyticsRepository.findOne({ where: { productId } });
			if (!analytics) {
				this.logger.warn(`⚠️ [updateStockHistory] Product analytics not found for ID: ${productId}. Creating new analytics record.`);
				
				// Auto-create analytics for this product
				try {
					analytics = this.analyticsRepository.create({
						productId,
						totalUnitsSold: 0,
						totalRevenue: 0,
						salesCount: 0,
						viewCount: 0,
						cartAddCount: 0,
						wishlistCount: 0,
						quotationCount: 0,
						quotationToOrderCount: 0,
						conversionRate: 0,
						stockHistory: [],
						salesHistory: [],
						priceHistory: []
					});
					analytics = await this.analyticsRepository.save(analytics);
					this.logger.log(`✅ [updateStockHistory] Created new analytics record for product ID: ${productId}`);
				} catch (createError) {
					this.logger.error(`❌ [updateStockHistory] Failed to create analytics for product ID ${productId}: ${createError.message}`);
					return { message: 'Failed to create product analytics' };
				}
			}

			this.logger.debug(`🔍 [updateStockHistory] Finding product for stock balance check`);
			const product = await this.productRepository.findOne({ where: { uid: productId } });
			if (!product) {
				this.logger.warn(`⚠️ [updateStockHistory] Product not found for ID: ${productId}`);
				throw new NotFoundException('Product not found');
			}

			this.logger.debug(`📝 [updateStockHistory] Adding stock history entry - quantity: ${quantity}, type: ${type}, balance: ${product.stockQuantity}`);
			const stockHistory = analytics.stockHistory || [];
			stockHistory.push({
				date: new Date(),
				quantity,
				type,
				balance: product.stockQuantity,
			});

			this.logger.debug(`💾 [updateStockHistory] Updating stock history in database`);
			await this.analyticsRepository.update({ productId }, { stockHistory });
			
			this.logger.log(`✅ [updateStockHistory] Stock history updated successfully for product ID: ${productId}`);
			return { message: 'Stock history updated successfully' };
		} catch (error) {
			this.logger.error(`❌ [updateStockHistory] Error updating stock history for product ID ${productId}: ${error.message}`, error.stack);
			return { message: error.message || 'Error updating stock history' };
		}
	}

	/**
	 * 📊 Calculate comprehensive product performance metrics
	 * @param productId - Product ID
	 * @returns Promise with performance metrics or error
	 */
	async calculateProductPerformance(productId: number) {
		this.logger.log(`📊 [calculateProductPerformance] Calculating performance metrics for product ID: ${productId}`);
		
		try {
			this.logger.debug(`🔍 [calculateProductPerformance] Finding analytics for product ID: ${productId}`);
			let analytics = await this.analyticsRepository.findOne({ where: { productId } });
			if (!analytics) {
				this.logger.warn(`⚠️ [calculateProductPerformance] Product analytics not found for ID: ${productId}. Creating new analytics record.`);
				
				// Auto-create analytics for this product
				try {
					analytics = this.analyticsRepository.create({
						productId,
						totalUnitsSold: 0,
						totalRevenue: 0,
						salesCount: 0,
						viewCount: 0,
						cartAddCount: 0,
						wishlistCount: 0,
						quotationCount: 0,
						quotationToOrderCount: 0,
						conversionRate: 0,
						stockHistory: [],
						salesHistory: [],
						priceHistory: []
					});
					analytics = await this.analyticsRepository.save(analytics);
					this.logger.log(`✅ [calculateProductPerformance] Created new analytics record for product ID: ${productId}`);
				} catch (createError) {
					this.logger.error(`❌ [calculateProductPerformance] Failed to create analytics for product ID ${productId}: ${createError.message}`);
					return { 
						message: 'Failed to create product analytics',
						performance: {
							viewToCartRate: 0,
							cartToSaleRate: 0,
							viewToSaleRate: 0,
							avgSaleValue: 0,
							profitMargin: null,
							stockTurnoverRate: 0,
							performanceScore: 0,
							rank: 'unranked'
						}
					};
				}
			}

			// Calculate conversion rates
			this.logger.debug(`📈 [calculateProductPerformance] Calculating conversion rates`);
			const viewToCartRate = analytics.viewCount ? (analytics.cartAddCount / analytics.viewCount) * 100 : 0;
			const cartToSaleRate = analytics.cartAddCount ? (analytics.salesCount / analytics.cartAddCount) * 100 : 0;
			const viewToSaleRate = analytics.viewCount ? (analytics.salesCount / analytics.viewCount) * 100 : 0;

			// Calculate average sale value
			const avgSaleValue = analytics.salesCount ? analytics.totalRevenue / analytics.salesCount : 0;
			this.logger.debug(`💰 [calculateProductPerformance] Average sale value: ${avgSaleValue}`);

			// Calculate profit margin if cost data is available
			const profitMargin =
				analytics.totalPurchaseCost && analytics.totalRevenue
					? ((analytics.totalRevenue - analytics.totalPurchaseCost) / analytics.totalRevenue) * 100
					: null;
			
			this.logger.debug(`📊 [calculateProductPerformance] Profit margin: ${profitMargin ? profitMargin.toFixed(2) + '%' : 'N/A'}`);

			// Calculate stock turnover rate
			const stockTurnoverRate = parseFloat(
				(analytics.totalUnitsSold / (analytics.unitsPurchased || 1)).toFixed(2),
			);
			this.logger.debug(`🔄 [calculateProductPerformance] Stock turnover rate: ${stockTurnoverRate}`);

			// Update the performance metrics
			this.logger.debug(`💾 [calculateProductPerformance] Updating performance metrics in database`);
			await this.analyticsRepository.update(
				{ productId },
				{
					profitMargin: profitMargin ? parseFloat(profitMargin.toFixed(2)) : null,
					stockTurnoverRate: stockTurnoverRate,
				},
			);

			const performance = {
				viewToCartRate: parseFloat(viewToCartRate.toFixed(2)),
				cartToSaleRate: parseFloat(cartToSaleRate.toFixed(2)),
				viewToSaleRate: parseFloat(viewToSaleRate.toFixed(2)),
				avgSaleValue: parseFloat(avgSaleValue.toFixed(2)),
				totalRevenue: analytics.totalRevenue,
				totalUnitsSold: analytics.totalUnitsSold,
				salesCount: analytics.salesCount,
				viewCount: analytics.viewCount,
				cartAddCount: analytics.cartAddCount,
				wishlistCount: analytics.wishlistCount,
				profitMargin: profitMargin ? parseFloat(profitMargin.toFixed(2)) : null,
			};

			this.logger.log(`✅ [calculateProductPerformance] Performance calculated successfully for product ID: ${productId}`);
			this.logger.debug(`📊 [calculateProductPerformance] Performance metrics: ${JSON.stringify(performance)}`);

			return {
				message: 'Performance calculated successfully',
				performance,
			};
		} catch (error) {
			this.logger.error(`❌ [calculateProductPerformance] Error calculating performance for product ID ${productId}: ${error.message}`, error.stack);
			return {
				message: error.message || 'Error calculating performance',
				performance: null,
			};
		}
	}

	/**
	 * 📋 Check if sufficient stock is available for a product
	 * @param productId - Product ID
	 * @param quantity - Required quantity
	 * @returns Promise<boolean> - True if stock is available
	 */
	async isStockAvailable(productId: number, quantity: number): Promise<boolean> {
		this.logger.log(`📋 [isStockAvailable] Checking stock availability for product ID: ${productId}, required quantity: ${quantity}`);
		
		try {
			this.logger.debug(`🔍 [isStockAvailable] Getting product details for stock check`);
			const product = await this.getProductByref(productId);
			
			const isAvailable = product && product.product && product.product.stockQuantity >= quantity;
			const currentStock = product?.product?.stockQuantity || 0;
			
			this.logger.log(`${isAvailable ? '✅' : '❌'} [isStockAvailable] Stock check result for product ID ${productId}: ${isAvailable ? 'Available' : 'Insufficient'} (current: ${currentStock}, required: ${quantity})`);
			
			return isAvailable;
		} catch (error) {
			this.logger.error(`❌ [isStockAvailable] Error checking stock availability for product ID ${productId}: ${error.message}`, error.stack);
			return false;
		}
	}

	/**
	 * 📦 Update product stock quantity
	 * @param productId - Product ID
	 * @param quantityChange - Change in quantity (positive for increase, negative for decrease)
	 * @returns Promise<void>
	 */
	async updateStock(productId: number, quantityChange: number): Promise<void> {
		this.logger.log(`📦 [updateStock] Updating stock for product ID: ${productId}, quantity change: ${quantityChange}`);
		
		try {
			this.logger.debug(`🔍 [updateStock] Getting current product details`);
			const product = await this.getProductByref(productId);
			if (!product.product) {
				this.logger.warn(`⚠️ [updateStock] Product not found with ID: ${productId}`);
				throw new NotFoundException(`Product with ID ${productId} not found`);
			}

			const currentStock = product.product.stockQuantity;
			const newStock = Math.max(0, currentStock + quantityChange);
			
			this.logger.debug(`📊 [updateStock] Stock update - current: ${currentStock}, change: ${quantityChange}, new: ${newStock}`);
			
			await this.productRepository.update(productId, { stockQuantity: newStock });

			// Update stock history
			this.logger.debug(`📝 [updateStock] Recording stock history for the change`);
			await this.updateStockHistory(productId, Math.abs(quantityChange), quantityChange > 0 ? 'in' : 'out');
			
			this.logger.log(`✅ [updateStock] Stock updated successfully for product ID: ${productId} (${currentStock} → ${newStock})`);
		} catch (error) {
			this.logger.error(`❌ [updateStock] Error updating stock for product ID ${productId}: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 📋 Record quotation creation for analytics
	 * @param productId - Product ID
	 * @returns Promise<void>
	 */
	async recordQuotationCreation(productId: number): Promise<void> {
		this.logger.log(`📋 [recordQuotationCreation] Recording quotation creation for product ID: ${productId}`);
		
		try {
			this.logger.debug(`🔍 [recordQuotationCreation] Finding analytics for product ID: ${productId}`);
			const analytics = await this.analyticsRepository.findOne({ where: { productId } });
			if (!analytics) {
				this.logger.warn(`⚠️ [recordQuotationCreation] Product analytics not found for ID: ${productId}`);
				throw new NotFoundException('Product analytics not found');
			}

			const newQuotationCount = (analytics.quotationCount || 0) + 1;
			this.logger.debug(`📊 [recordQuotationCreation] Updating quotation count from ${analytics.quotationCount || 0} to ${newQuotationCount}`);

			await this.analyticsRepository.update(
				{ productId },
				{ quotationCount: newQuotationCount },
			);
			
			this.logger.log(`✅ [recordQuotationCreation] Quotation creation recorded successfully for product ID: ${productId}`);
		} catch (error) {
			this.logger.error(`❌ [recordQuotationCreation] Error recording quotation creation for product ID ${productId}: ${error.message}`, error.stack);
			// Don't throw, just log the error
		}
	}
}
