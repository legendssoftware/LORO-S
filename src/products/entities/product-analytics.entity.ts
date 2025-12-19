import { Product } from './product.entity';
import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('product_analytics')
export class ProductAnalytics {
    @PrimaryGeneratedColumn()
    uid: number;

    @OneToOne(() => Product, { onDelete: 'CASCADE' })
    @JoinColumn()
    product: Product;

    @Column()
    productId: number;

    // Sales Metrics
    @Column({ type: 'int', default: 0 })
    totalUnitsSold: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    totalRevenue: number;

    @Column({ type: 'timestamptz', nullable: true })
    lastSaleDate: Date;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    averageSellingPrice: number;

    @Column({ type: 'int', default: 0 })
    salesCount: number;

    // Purchase Metrics
    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    totalPurchaseCost: number;

    @Column({ type: 'int', default: 0 })
    unitsPurchased: number;

    @Column({ type: 'timestamptz', nullable: true })
    lastPurchaseDate: Date;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    averagePurchasePrice: number;

    // Performance Metrics
    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    profitMargin: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    stockTurnoverRate: number;

    @Column({ type: 'int', nullable: true })
    daysInInventory: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
    returnRate: number;

    @Column({ type: 'decimal', precision: 3, scale: 1, nullable: true })
    customerSatisfactionScore: number;

    // Trend Data
    @Column({ type: 'json', nullable: true })
    priceHistory: any;

    @Column({ type: 'json', nullable: true })
    salesHistory: any;

    @Column({ type: 'json', nullable: true })
    stockHistory: any;

    @Column({ type: 'int', nullable: true })
    categoryRank: number;

    // Views and Engagement
    @Column({ type: 'int', default: 0 })
    viewCount: number;

    @Column({ type: 'int', default: 0 })
    cartAddCount: number;

    @Column({ type: 'int', default: 0 })
    wishlistCount: number;

    // Conversion Tracking
    @Column({ type: 'int', default: 0 })
    quotationCount: number;

    @Column({ type: 'int', default: 0 })
    quotationToOrderCount: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
    conversionRate: number;

    @Column({ type: 'json', nullable: true })
    conversionHistory: {
        quotationId: number;
        orderId: number;
        convertedAt: Date;
    }[];

    // Timestamps
    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;
}