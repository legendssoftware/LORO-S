import { Logger } from '@nestjs/common';
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Quotation } from './entities/quotation.entity';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class ShopGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private logger = new Logger('ShopGateway');

    handleConnection(client: Socket) {
        this.logger.log(`🔌 Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`🔌 Client disconnected: ${client.id}`);
    }

    /**
     * 🆕 Emit new quotation created event with comprehensive data
     * @param quotationData - Full quotation entity with all relations
     */
    async emitNewQuotation(quotationData: Quotation) {
        try {
            const quotationPayload = {
                uid: quotationData.uid,
                quotationNumber: quotationData.quotationNumber,
                totalAmount: quotationData.totalAmount,
                totalItems: quotationData.totalItems,
                status: quotationData.status,
                quotationDate: quotationData.quotationDate,
                notes: quotationData.notes,
                shippingMethod: quotationData.shippingMethod,
                shippingInstructions: quotationData.shippingInstructions,
                packagingRequirements: quotationData.packagingRequirements,
                promoCode: quotationData.promoCode,
                resellerCommission: quotationData.resellerCommission,
                currency: quotationData.currency,
                validUntil: quotationData.validUntil,
                reviewToken: quotationData.reviewToken,
                reviewUrl: quotationData.reviewUrl,
                pdfURL: quotationData.pdfURL,
                isConverted: quotationData.isConverted,
                convertedAt: quotationData.convertedAt,
                convertedBy: quotationData.convertedBy,
                createdAt: quotationData.createdAt,
                updatedAt: quotationData.updatedAt,
                client: quotationData.client ? {
                    uid: quotationData.client.uid,
                    name: quotationData.client.name,
                    email: quotationData.client.email,
                    phone: quotationData.client.phone,
                    contactPerson: quotationData.client.contactPerson,
                    category: quotationData.client.category,
                    website: quotationData.client.website,
                    industry: quotationData.client.industry,
                    status: quotationData.client.status,
                } : null,
                placedBy: quotationData.placedBy ? {
                    uid: quotationData.placedBy.uid,
                    name: quotationData.placedBy.name,
                    email: quotationData.placedBy.email,
                    phone: quotationData.placedBy.phone,
                    username: quotationData.placedBy.username,
                    organisationRef: quotationData.placedBy.organisationRef,
                    photoURL: quotationData.placedBy.photoURL,
                    surname: quotationData.placedBy.surname,
                    accessLevel: quotationData.placedBy.accessLevel,
                } : null,
                branch: quotationData.branch ? {
                    uid: quotationData.branch.uid,
                    name: quotationData.branch.name,
                    email: quotationData.branch.email,
                    phone: quotationData.branch.phone,
                    contactPerson: quotationData.branch.contactPerson,
                    ref: quotationData.branch.ref,
                    address: quotationData.branch.address,
                    website: quotationData.branch.website,
                    status: quotationData.branch.status,
                } : null,
                organisation: quotationData.organisation ? {
                    uid: quotationData.organisation.uid,
                    name: quotationData.organisation.name,
                    email: quotationData.organisation.email,
                    phone: quotationData.organisation.phone,
                    website: quotationData.organisation.website,
                    address: quotationData.organisation.address,
                    logo: quotationData.organisation.logo,
                    status: quotationData.organisation.status,
                } : null,
                quotationItems: quotationData.quotationItems?.map(item => ({
                    uid: item.uid,
                    quantity: item.quantity,
                    totalPrice: item.totalPrice,
                    unitPrice: item.quantity > 0 ? item.totalPrice / item.quantity : 0,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    product: item.product ? {
                        uid: item.product.uid,
                        name: item.product.name,
                        description: item.product.description,
                        category: item.product.category,
                        price: item.product.price,
                        salePrice: item.product.salePrice,
                        imageUrl: item.product.imageUrl,
                        productRef: item.product.productRef,
                        stockQuantity: item.product.stockQuantity,
                        reorderPoint: item.product.reorderPoint,
                        weight: item.product.weight,
                        dimensions: item.product.dimensions,
                        brand: item.product.brand,
                        model: item.product.model,
                        sku: item.product.sku,
                        barcode: item.product.barcode,
                        features: item.product.features,
                        specifications: item.product.specifications,
                        warrantyPeriod: item.product.warrantyPeriod,
                        warrantyUnit: item.product.warrantyUnit,
                        status: item.product.status,
                        isDeleted: item.product.isDeleted,
                        createdAt: item.product.createdAt,
                        updatedAt: item.product.updatedAt,
                    } : null,
                })) || [],
                reseller: quotationData.reseller ? {
                    uid: quotationData.reseller.uid,
                    name: quotationData.reseller.name,
                    email: quotationData.reseller.email,
                    phone: quotationData.reseller.phone,
                    username: quotationData.reseller.username,
                    organisationRef: quotationData.reseller.organisationRef,
                    photoURL: quotationData.reseller.photoURL,
                    surname: quotationData.reseller.surname,
                    accessLevel: quotationData.reseller.accessLevel,
                } : null,
            };

            this.server.emit('quotation:new', quotationPayload);
            this.logger.log(`🚀 New quotation event emitted: ${quotationData.quotationNumber}`);
        } catch (error) {
            this.logger.error('❌ Error emitting new quotation event:', error.stack);
        }
    }

    /**
     * 🔄 Emit quotation status changed event
     * @param quotationData - Updated quotation entity with all relations
     */
    async notifyQuotationStatusChanged(quotationData: Quotation) {
        try {
            const quotationPayload = {
                uid: quotationData.uid,
                quotationNumber: quotationData.quotationNumber,
                totalAmount: quotationData.totalAmount,
                totalItems: quotationData.totalItems,
                status: quotationData.status,
                quotationDate: quotationData.quotationDate,
                notes: quotationData.notes,
                shippingMethod: quotationData.shippingMethod,
                shippingInstructions: quotationData.shippingInstructions,
                packagingRequirements: quotationData.packagingRequirements,
                promoCode: quotationData.promoCode,
                resellerCommission: quotationData.resellerCommission,
                currency: quotationData.currency,
                validUntil: quotationData.validUntil,
                reviewToken: quotationData.reviewToken,
                reviewUrl: quotationData.reviewUrl,
                pdfURL: quotationData.pdfURL,
                isConverted: quotationData.isConverted,
                convertedAt: quotationData.convertedAt,
                convertedBy: quotationData.convertedBy,
                createdAt: quotationData.createdAt,
                updatedAt: quotationData.updatedAt,
                client: quotationData.client ? {
                    uid: quotationData.client.uid,
                    name: quotationData.client.name,
                    email: quotationData.client.email,
                    phone: quotationData.client.phone,
                    contactPerson: quotationData.client.contactPerson,
                    category: quotationData.client.category,
                    website: quotationData.client.website,
                    industry: quotationData.client.industry,
                    status: quotationData.client.status,
                } : null,
                placedBy: quotationData.placedBy ? {
                    uid: quotationData.placedBy.uid,
                    name: quotationData.placedBy.name,
                    email: quotationData.placedBy.email,
                    phone: quotationData.placedBy.phone,
                    username: quotationData.placedBy.username,
                    organisationRef: quotationData.placedBy.organisationRef,
                    photoURL: quotationData.placedBy.photoURL,
                    surname: quotationData.placedBy.surname,
                    accessLevel: quotationData.placedBy.accessLevel,
                } : null,
                branch: quotationData.branch ? {
                    uid: quotationData.branch.uid,
                    name: quotationData.branch.name,
                    email: quotationData.branch.email,
                    phone: quotationData.branch.phone,
                    contactPerson: quotationData.branch.contactPerson,
                    ref: quotationData.branch.ref,
                    address: quotationData.branch.address,
                    website: quotationData.branch.website,
                    status: quotationData.branch.status,
                } : null,
                organisation: quotationData.organisation ? {
                    uid: quotationData.organisation.uid,
                    name: quotationData.organisation.name,
                    email: quotationData.organisation.email,
                    phone: quotationData.organisation.phone,
                    website: quotationData.organisation.website,
                    address: quotationData.organisation.address,
                    logo: quotationData.organisation.logo,
                    status: quotationData.organisation.status,
                } : null,
                quotationItems: quotationData.quotationItems?.map(item => ({
                    uid: item.uid,
                    quantity: item.quantity,
                    totalPrice: item.totalPrice,
                    unitPrice: item.quantity > 0 ? item.totalPrice / item.quantity : 0,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    product: item.product ? {
                        uid: item.product.uid,
                        name: item.product.name,
                        description: item.product.description,
                        category: item.product.category,
                        price: item.product.price,
                        salePrice: item.product.salePrice,
                        imageUrl: item.product.imageUrl,
                        productRef: item.product.productRef,
                        stockQuantity: item.product.stockQuantity,
                        reorderPoint: item.product.reorderPoint,
                        weight: item.product.weight,
                        dimensions: item.product.dimensions,
                        brand: item.product.brand,
                        model: item.product.model,
                        sku: item.product.sku,
                        barcode: item.product.barcode,
                        features: item.product.features,
                        specifications: item.product.specifications,
                        warrantyPeriod: item.product.warrantyPeriod,
                        warrantyUnit: item.product.warrantyUnit,
                        status: item.product.status,
                        isDeleted: item.product.isDeleted,
                        createdAt: item.product.createdAt,
                        updatedAt: item.product.updatedAt,
                    } : null,
                })) || [],
                reseller: quotationData.reseller ? {
                    uid: quotationData.reseller.uid,
                    name: quotationData.reseller.name,
                    email: quotationData.reseller.email,
                    phone: quotationData.reseller.phone,
                    username: quotationData.reseller.username,
                    organisationRef: quotationData.reseller.organisationRef,
                    photoURL: quotationData.reseller.photoURL,
                    surname: quotationData.reseller.surname,
                    accessLevel: quotationData.reseller.accessLevel,
                } : null,
            };

            this.server.emit('quotation:status-changed', quotationPayload);
            this.logger.log(`🔄 Quotation status changed event emitted: ${quotationData.quotationNumber} - ${quotationData.status}`);
        } catch (error) {
            this.logger.error('❌ Error emitting quotation status changed event:', error.stack);
        }
    }

    /**
     * 📊 Emit quotation metrics for real-time dashboard updates
     * @param quotationData - Quotation entity with all relations
     */
    async emitQuotationMetrics(quotationData: Quotation) {
        try {
            const metricsPayload = {
                uid: quotationData.uid,
                quotationNumber: quotationData.quotationNumber,
                totalAmount: quotationData.totalAmount,
                totalItems: quotationData.totalItems,
                status: quotationData.status,
                quotationDate: quotationData.quotationDate,
                validUntil: quotationData.validUntil,
                isConverted: quotationData.isConverted,
                convertedAt: quotationData.convertedAt,
                currency: quotationData.currency,
                resellerCommission: quotationData.resellerCommission,
                client: quotationData.client ? {
                    uid: quotationData.client.uid,
                    name: quotationData.client.name,
                    email: quotationData.client.email,
                    phone: quotationData.client.phone,
                } : null,
                placedBy: quotationData.placedBy ? {
                    uid: quotationData.placedBy.uid,
                    name: quotationData.placedBy.name,
                    email: quotationData.placedBy.email,
                    phone: quotationData.placedBy.phone,
                } : null,
                branch: quotationData.branch ? {
                    uid: quotationData.branch.uid,
                    name: quotationData.branch.name,
                    ref: quotationData.branch.ref,
                } : null,
                organisation: quotationData.organisation ? {
                    uid: quotationData.organisation.uid,
                    name: quotationData.organisation.name,
                } : null,
                quotationItems: quotationData.quotationItems?.map(item => ({
                    uid: item.uid,
                    quantity: item.quantity,
                    totalPrice: item.totalPrice,
                    unitPrice: item.quantity > 0 ? item.totalPrice / item.quantity : 0,
                    product: item.product ? {
                        uid: item.product.uid,
                        name: item.product.name,
                        category: item.product.category,
                        price: item.product.price,
                        productRef: item.product.productRef,
                    } : null,
                })) || [],
            };

            this.server.emit('quotation:metrics', metricsPayload);
            this.logger.log(`📊 Quotation metrics emitted: ${quotationData.quotationNumber}`);
        } catch (error) {
            this.logger.error('❌ Error emitting quotation metrics:', error.stack);
        }
    }

    /**
     * 🔔 Emit general notification event
     * @param type - Notification type
     * @param message - Notification message
     * @param data - Additional data (optional)
     */
    async emitNotification(type: string, message: string, data?: any) {
        try {
            const notificationPayload = {
                type,
                message,
                timestamp: new Date(),
                data: data || null,
            };

            this.server.emit('notification', notificationPayload);
            this.logger.log(`🔔 Notification emitted: ${type} - ${message}`);
        } catch (error) {
            this.logger.error('❌ Error emitting notification:', error.stack);
        }
    }

    @SubscribeMessage('quotation:subscribe')
    handleSubscribeToQuotations(client: Socket, payload: any) {
        this.logger.log(`📢 Client ${client.id} subscribed to quotation updates`);
        client.emit('quotation:subscribed', { status: 'subscribed' });
    }

    @SubscribeMessage('quotation:unsubscribe')
    handleUnsubscribeFromQuotations(client: Socket, payload: any) {
        this.logger.log(`📢 Client ${client.id} unsubscribed from quotation updates`);
        client.emit('quotation:unsubscribed', { status: 'unsubscribed' });
    }
} 