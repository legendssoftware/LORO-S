import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Quotation } from '../entities/quotation.entity';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { ProductsService } from '../../products/products.service';
import { OrderStatus } from '../../lib/enums/status.enums';
import { QuotationConversionDto } from '../dto/quotation-conversion.dto';
import { User } from '../../user/entities/user.entity';
import { EmailType } from '../../lib/enums/email.enums';

type UserWithoutPassword = Omit<User, 'password'>;

// Utility function to convert User without password to User for TypeORM
const convertToUser = (user: UserWithoutPassword): User => {
	return {
		...user,
		password: '', // Add an empty password string for type compatibility
	} as User;
};

@Injectable()
export class QuotationConversionService {
	private readonly logger = new Logger(QuotationConversionService.name);

	constructor(
		@InjectRepository(Quotation)
		private readonly quotationRepository: Repository<Quotation>,
		@InjectRepository(Order)
		private readonly orderRepository: Repository<Order>,
		@InjectRepository(OrderItem)
		private readonly orderItemRepository: Repository<OrderItem>,
		private readonly productsService: ProductsService,
		private readonly connection: Connection,
		private readonly eventEmitter: EventEmitter2,
	) {}

	async convertToOrder(
		quotationId: number,
		conversionData: QuotationConversionDto,
		currentUser: UserWithoutPassword,
		orgId?: number,
		branchId?: number,
	): Promise<{ success: boolean; message: string; order?: Order }> {
		const queryRunner = this.connection.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// === CRITICAL PATH ===
			// Build query with org filter only (no branch; access by role)
			const quotationQueryBuilder = queryRunner.manager
				.createQueryBuilder(Quotation, 'quotation')
				.where('quotation.uid = :quotationId', { quotationId });

			if (orgId) {
				quotationQueryBuilder.andWhere('quotation.organisation.uid = :orgId', { orgId });
			}

			const quotation = await quotationQueryBuilder.getOne();

			if (!quotation) {
				throw new NotFoundException(`Quotation with ID ${quotationId} not found`);
			}

			// Validate quotation status
			await this.validateQuotationForConversion(quotation, queryRunner.manager);

			// Create order from quotation
			const order = await this.createOrderFromQuotation(
				quotation,
				conversionData,
				currentUser,
				queryRunner.manager,
			);

			// Mark quotation as converted
			await queryRunner.manager.update(Quotation, quotation.uid, {
				isConverted: true,
				convertedAt: new Date(),
				convertedBy: currentUser.uid,
				status: OrderStatus.IN_FULFILLMENT,
			});

			await queryRunner.commitTransaction();

			// === EARLY RETURN ===
			const immediateResponse = {
				success: true,
				message: `Quotation ${quotation.quotationNumber} successfully converted to order ${order.orderNumber}`,
				order,
			};

			// === POST-RESPONSE PROCESSING ===
			setImmediate(async () => {
				const asyncOperationId = `QUOTATION_CONVERSION_ASYNC_${quotationId}_${Date.now()}`;
				this.logger.log(`[${asyncOperationId}] Starting async post-conversion processing for quotation ${quotation.quotationNumber}`);

				try {
					// Reload order with relations for analytics
					const fullOrder = await this.orderRepository.findOne({
						where: { uid: order.uid },
						relations: ['orderItems', 'orderItems.product'],
					});

					if (fullOrder) {
						// Update product analytics for each item
						await this.updateProductAnalytics(fullOrder, quotation);

						// Send notifications
						this.sendNotifications(quotation, fullOrder);

						// Trigger user target recalculation after successful conversion
						this.eventEmitter.emit('user.target.update.required', {
							userId: quotation.placedBy.uid,
						});

						this.logger.log(`[${asyncOperationId}] Async post-conversion processing completed successfully`);
					}
				} catch (error) {
					this.logger.error(`[${asyncOperationId}] Error in async post-conversion processing: ${error.message}`, error.stack);
					// Don't throw - user already has success response
				}
			});

			return immediateResponse;
		} catch (error) {
			this.logger.error(`Error converting quotation ${quotationId} to order: ${error.message}`, error.stack);
			await queryRunner.rollbackTransaction();

			// Emit failure event
			this.eventEmitter.emit('quotation.conversion.failed', {
				quotationId,
				error: error.message,
			});

			return {
				success: false,
				message: `Failed to convert quotation: ${error.message}`,
			};
		} finally {
			await queryRunner.release();
		}
	}

	private async validateQuotationForConversion(quotation: Quotation, entityManager: EntityManager): Promise<void> {
		// Check if quotation is already converted
		if (quotation.isConverted) {
			throw new ConflictException(
				`Quotation ${quotation.quotationNumber} has already been converted to an order`,
			);
		}

		// Check if quotation is in approved status
		if (quotation.status !== OrderStatus.APPROVED) {
			throw new ConflictException(
				`Only approved quotations can be converted to orders. Current status: ${quotation.status}`,
			);
		}

		// Check if quotation has items
		if (!quotation.quotationItems || quotation.quotationItems.length === 0) {
			throw new ConflictException(`Cannot convert quotation with no items`);
		}

		// Check if all products are available
		for (const item of quotation.quotationItems) {
			const product = item.product;
			const stockAvailable = await this.productsService.isStockAvailable(product.uid, item.quantity);

			if (!stockAvailable) {
				throw new ConflictException(`Insufficient stock for product: ${product.name}`);
			}
		}
	}

	private async createOrderFromQuotation(
		quotation: Quotation,
		conversionData: QuotationConversionDto,
		currentUser: UserWithoutPassword,
		entityManager: EntityManager,
	): Promise<Order> {
		// Create basic order
		const orderNumber = `ORD-${Date.now()}`;

		const order = new Order();
		order.orderNumber = orderNumber;
		order.totalAmount = quotation?.totalAmount;
		order.totalItems = quotation?.totalItems;
		order.status = OrderStatus.IN_FULFILLMENT;
		order.orderDate = new Date();
		order.placedBy = convertToUser(currentUser);
		order.client = quotation?.client;
		order.quotation = quotation;
		order.quotationId = quotation?.uid;
		order.quotationNumber = quotation?.quotationNumber;
		order.shippingMethod = conversionData.shippingMethod || quotation?.shippingMethod;
		order.notes = conversionData.notes || quotation?.notes;
		order.shippingInstructions = conversionData.shippingInstructions || quotation?.shippingInstructions;
		order.packagingRequirements = quotation?.packagingRequirements;
		order.reseller = quotation?.reseller;
		order.resellerCommission = quotation?.resellerCommission;
		order.branch = quotation?.branch;
		order.organisation = quotation?.organisation;

		// Handle payment information if provided
		if (conversionData.markAsPaid) {
			order.isPaid = true;
			order.paidAt = new Date();
			order.paymentMethod = conversionData?.paymentMethod;
			order.paymentReference = conversionData?.paymentReference;
			order.paidAmount = conversionData?.paidAmount || quotation?.totalAmount;
			order.status = OrderStatus.PAID;
		}

		// Save the order first to get its ID
		const savedOrder = await entityManager.save(Order, order);

		// Create order items
		const orderItems: OrderItem[] = [];

		for (const quoItem of quotation.quotationItems) {
			const orderItem = new OrderItem();
			orderItem.order = savedOrder;
			orderItem.product = quoItem.product;
			orderItem.quantity = quoItem.quantity;
			orderItem.unitPrice = quoItem.product.price;
			orderItem.totalPrice = quoItem.totalPrice;
			orderItem.notes = 'Thank you for your order';

			orderItems.push(orderItem);
		}

		// Save order items
		await entityManager.save(OrderItem, orderItems);

		// Reload the order with items
		return await entityManager.findOne(Order, {
			where: { uid: savedOrder.uid },
			relations: ['orderItems', 'orderItems.product'],
		});
	}

	private async updateProductAnalytics(
		order: Order,
		quotation: Quotation,
	): Promise<void> {
		for (const item of order.orderItems) {
			const productId = item.product.uid;

			// Record sale
			await this.productsService.recordSale(productId, item.quantity, Number(item.totalPrice));

			// Update conversion metrics
			const analytics = await this.productsService.getProductAnalytics(productId);

			if (analytics?.analytics) {
				const currentAnalytics = analytics.analytics;

				// Increment quotation to order conversion count
				const quotationToOrderCount = (currentAnalytics.quotationToOrderCount || 0) + 1;

				// Calculate conversion rate
				const quotationCount = currentAnalytics.quotationCount || 0;
				const conversionRate = quotationCount > 0 ? (quotationToOrderCount / quotationCount) * 100 : 0;

				// Update conversion history
				const conversionHistory = currentAnalytics.conversionHistory || [];
				conversionHistory.push({
					quotationId: quotation.uid,
					orderId: order.uid,
					convertedAt: new Date(),
				});

				// Update analytics
				await this.productsService.updateProductAnalytics(productId, {
					quotationToOrderCount,
					conversionRate,
					conversionHistory,
				});

				// Update product stock
				await this.productsService.updateStock(
					productId,
					-item.quantity, // Reduce stock by quantity ordered
				);
			}

			// Calculate updated performance metrics
			await this.productsService.calculateProductPerformance(productId);
		}
	}

	private sendNotifications(quotation: Quotation, order: Order): void {
		// Emit events for order creation
		this.eventEmitter.emit('quotation.conversion.completed', {
			quotationId: quotation.uid,
			orderId: order.uid,
		});

		this.eventEmitter.emit('order.created', {
			order,
		});

		// Send email to client about order creation
		if (quotation.client?.email) {
			this.eventEmitter.emit('send.email', EmailType.QUOTATION_IN_FULFILLMENT, [quotation.client.email], {
				name: quotation.client.name || 'Valued Customer',
				quotationId: quotation.quotationNumber,
				orderNumber: order.orderNumber,
				total: order.totalAmount,
				currency: 'USD', // Set your currency or get from config
				status: order.status,
				quotationItems: order.orderItems.map((item) => ({
					quantity: item.quantity,
					product: {
						uid: item.product.uid,
						name: item.product.name,
						code: item.product.sku || item.product.productRef,
					},
					totalPrice: item.totalPrice,
				})),
			});

			// Log push notification limitation for external clients
			console.log(`Order fulfillment email sent to client ${quotation.client.email} - push notifications not available for external clients`);
		}
	}

	async getConversionStatus(quotationId: number): Promise<{
		quotationId: number;
		isConverted: boolean;
		convertedAt?: Date;
		orderId?: number;
		orderNumber?: string;
	}> {
		const quotation = await this.quotationRepository.findOne({
			where: { uid: quotationId },
		});

		if (!quotation) {
			throw new NotFoundException(`Quotation with ID ${quotationId} not found`);
		}

		if (!quotation.isConverted) {
			return {
				quotationId,
				isConverted: false,
			};
		}

		// Find orders related to this quotation
		const orders = await this.orderRepository.find({
			where: { quotationId: quotationId },
			order: { createdAt: 'DESC' },
		});

		// Get the most recent order
		const order = orders && orders.length > 0 ? orders[0] : null;

		return {
			quotationId,
			isConverted: true,
			convertedAt: quotation.convertedAt,
			orderId: order?.uid,
			orderNumber: order?.orderNumber,
		};
	}

	async rollbackConversion(quotationId: number, currentUser: UserWithoutPassword): Promise<{ success: boolean; message: string }> {
		const queryRunner = this.connection.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// Find the quotation
			const quotation = await queryRunner.manager.findOne(Quotation, {
				where: { uid: quotationId, isConverted: true },
				relations: ['quotationItems', 'quotationItems.product'],
			});

			if (!quotation) {
				throw new NotFoundException(`Quotation with ID ${quotationId} not found or not converted`);
			}

			// Find the associated order
			const order = await queryRunner.manager.findOne(Order, {
				where: { quotationId: quotation.uid },
				relations: ['orderItems', 'orderItems.product'],
			});

			if (!order) {
				throw new NotFoundException(`Order for quotation with ID ${quotationId} not found`);
			}

			// Check if order can be rolled back (only if not delivered, paid, etc.)
			const nonRollbackableStatuses = [
				OrderStatus.DELIVERED,
				OrderStatus.PAID,
				OrderStatus.OUTFORDELIVERY,
				OrderStatus.COMPLETED,
			];

			if (nonRollbackableStatuses.includes(order.status as OrderStatus)) {
				throw new ConflictException(
					`Cannot roll back conversion for quotation ${quotationId}. Order is already ${order.status}`,
				);
			}

			// Delete order items
			if (order.orderItems && order.orderItems.length > 0) {
				await queryRunner.manager.delete(OrderItem, { order: { uid: order.uid } });
			}

			// Delete the order
			await queryRunner.manager.delete(Order, { uid: order.uid });

			// Update quotation to mark as not converted
			await queryRunner.manager.update(Quotation, quotation.uid, {
				isConverted: false,
				convertedAt: null,
				convertedBy: null,
				status: OrderStatus.APPROVED,
			});

			// Emit event for rollback
			this.eventEmitter.emit('quotation.conversion.rollback', {
				quotationId,
				userId: convertToUser(currentUser).uid,
			});

			return {
				success: true,
				message: `Successfully rolled back conversion for quotation ${quotation.quotationNumber}`,
			};
		} catch (error) {
			this.logger.error(
				`Error rolling back conversion for quotation ${quotationId}: ${error.message}`,
				error.stack,
			);
			await queryRunner.rollbackTransaction();

			return {
				success: false,
				message: `Failed to roll back conversion: ${error.message}`,
			};
		} finally {
			await queryRunner.release();
		}
	}
}
