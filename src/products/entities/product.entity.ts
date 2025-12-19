import { Organisation } from 'src/organisation/entities/organisation.entity';
import { ProductStatus } from '../../lib/enums/product.enums';
import { QuotationItem } from '../../shop/entities/quotation-item.entity';
import { Reseller } from '../../resellers/entities/reseller.entity';
import { Branch } from 'src/branch/entities/branch.entity';
import { ProductAnalytics } from './product-analytics.entity';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, BeforeInsert, AfterInsert, ManyToOne, getRepository, OneToOne } from 'typeorm';

@Entity('product')
export class Product {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    price: number;

    @Column({ type: 'varchar', nullable: true })
    category: string;

    @Column({ type: 'enum', enum: ProductStatus, default: ProductStatus.NEW })
    status: ProductStatus;

    @Column({ nullable: true })
    imageUrl: string;

    @Column({ nullable: true })
    sku: string;

    @Column({ nullable: true })
    warehouseLocation: string;

    @Column({ default: 0 })
    stockQuantity: number;

    @Column({ nullable: false })
    productRef: string;

    @Column({ nullable: true })
    productReferenceCode: string;

    @Column({ default: 10 })
    reorderPoint: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    salePrice: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    discount: number;

    @Column({ nullable: true })
    barcode: string;

    @Column({ nullable: true })
    brand: string;

    @Column({ type: 'int', default: 0 })
    packageQuantity: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    weight: number;

    @Column({ default: false })
    isOnPromotion: boolean;

    @Column({ type: 'varchar', nullable: true })
    packageDetails: string;

    @Column({ type: 'timestamptz', nullable: true })
    promotionStartDate: Date;

    @Column({ type: 'timestamptz', nullable: true })
    promotionEndDate: Date;

    @Column({ type: 'varchar', default: 'unit' })
    packageUnit: string;

    // Enhanced pack and pallet quantities
    @Column({ type: 'int', default: 1 })
    itemsPerPack: number;

    @Column({ type: 'int', default: 1 })
    packsPerPallet: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    packPrice: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    palletPrice: number;

    @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
    packWeight: number;

    @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
    palletWeight: number;

    // NEW: Enhanced palette support fields
    @Column({ type: 'boolean', default: false })
    palletAvailable: boolean;

    @Column({ type: 'int', default: 0 })
    palletStockQuantity: number;

    @Column({ type: 'int', default: 1 })
    palletReorderPoint: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    palletDiscount: number;

    @Column({ type: 'varchar', nullable: true })
    palletSku: string;

    @Column({ type: 'varchar', nullable: true })
    palletBarcode: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    palletSalePrice: number;

    @Column({ type: 'boolean', default: false })
    palletOnPromotion: boolean;

    @Column({ type: 'timestamptz', nullable: true })
    palletPromotionStartDate: Date;

    @Column({ type: 'timestamptz', nullable: true })
    palletPromotionEndDate: Date;

    @Column({ type: 'text', nullable: true })
    palletDescription: string;

    @Column({ type: 'varchar', nullable: true })
    palletImageUrl: string;

    // Minimum order quantities for palette
    @Column({ type: 'int', default: 1 })
    minimumPalletOrderQuantity: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    palletBulkDiscountPercentage: number;

    @Column({ type: 'int', nullable: true })
    palletBulkDiscountMinQty: number;

    @Column({ type: 'varchar', nullable: true })
    dimensions: string;

    @Column({ type: 'varchar', nullable: true })
    packDimensions: string;

    @Column({ type: 'varchar', nullable: true })
    palletDimensions: string;

    @Column({ type: 'varchar', nullable: true })
    manufacturer: string;

    @Column({ type: 'varchar', nullable: true })
    model: string;

    @Column({ type: 'varchar', nullable: true })
    color: string;

    @Column({ type: 'varchar', nullable: true })
    material: string;

    @Column({ type: 'int', nullable: true })
    warrantyPeriod: number;

    @Column({ type: 'varchar', default: 'months' })
    warrantyUnit: string;

    @Column({ type: 'text', nullable: true })
    specifications: string;

    @Column({ type: 'text', nullable: true })
    features: string;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    rating: number;

    @Column({ type: 'int', default: 0 })
    reviewCount: number;

    @Column({ type: 'varchar', nullable: true })
    origin: string;

    @Column({ type: 'boolean', default: false })
    isFragile: boolean;

    @Column({ type: 'boolean', default: false })
    requiresSpecialHandling: boolean;

    @Column({ type: 'varchar', nullable: true })
    storageConditions: string;

    @Column({ type: 'int', nullable: true })
    minimumOrderQuantity: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    bulkDiscountPercentage: number;

    @Column({ type: 'int', nullable: true })
    bulkDiscountMinQty: number;

	@CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;

    @OneToMany(() => QuotationItem, quotationItem => quotationItem?.product)
    quotationItems: QuotationItem[];

    @ManyToOne(() => Reseller, reseller => reseller?.products)
    reseller: Reseller;

    @Column({ default: false })
    isDeleted: boolean;

    // Relations
    @ManyToOne(() => Organisation, (organisation) => organisation?.products, { nullable: true })
    organisation: Organisation;

    @ManyToOne(() => Branch, (branch) => branch?.products, { nullable: true })
    branch: Branch;

    @OneToOne(() => ProductAnalytics, analytics => analytics?.product, { cascade: true })
    analytics: ProductAnalytics;

    // Helper methods for palette calculations
    getPalletItemCount(): number {
        return this.itemsPerPack * this.packsPerPallet;
    }

    getPalletEffectivePrice(): number {
        if (this.palletOnPromotion && this.palletSalePrice) {
            return this.palletSalePrice;
        }
        return this.palletPrice || 0;
    }

    getPricePerItemFromPallet(): number {
        const totalItems = this.getPalletItemCount();
        const effectivePrice = this.getPalletEffectivePrice();
        return totalItems > 0 ? effectivePrice / totalItems : 0;
    }

    isPalletDiscountActive(): boolean {
        if (!this.palletOnPromotion) return false;
        const now = new Date();
        const startValid = !this.palletPromotionStartDate || now >= this.palletPromotionStartDate;
        const endValid = !this.palletPromotionEndDate || now <= this.palletPromotionEndDate;
        return startValid && endValid;
    }

    static generateSKU(category: string, name: string, uid: number, reseller: Reseller): string {
        // Get first 3 letters of category (uppercase)
        const categoryCode = (category || 'XXX').slice(0, 3).toUpperCase();

        // Get first 3 letters of product name (uppercase)
        const nameCode = (name || 'XXX').slice(0, 3).toUpperCase();

        // Get reseller code
        const resellerCode = reseller ? reseller.uid.toString().padStart(3, '0') : '000';

        // Pad the uid with zeros to ensure it's 6 digits
        const paddedUid = uid.toString().padStart(6, '0');

        // Simplified SKU format: CAT-NAME-RESELLER-UID
        return `${categoryCode}-${nameCode}-${resellerCode}-${paddedUid}`;
    }

    static generatePalletSKU(baseSku: string): string {
        return `${baseSku}-PLT`;
    }

    @BeforeInsert()
    async generateSKUBeforeInsert() {
        // Generate productRef if not provided
        if (!this.productRef) {
            this.productRef = `PRD${Math.floor(100000 + Math.random() * 900000)}`;
        }
        
        if (!this.sku && this.category && this.name) {
            this.sku = Product.generateSKU(this.category, this.name, 0, this.reseller);
        }
        
        // Auto-generate pallet SKU if palette is available
        if (this.palletAvailable && !this.palletSku && this.sku) {
            this.palletSku = Product.generatePalletSKU(this.sku);
        }
    }
}

