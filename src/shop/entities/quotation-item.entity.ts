import { Product } from "../../products/entities/product.entity";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from "typeorm";
import { Quotation } from "./quotation.entity";

@Entity('quotation_item')
@Index(['quotation']) // Quotation item queries
@Index(['product']) // Product usage tracking
@Index(['quotation', 'product']) // Composite quotation-product queries
export class QuotationItem {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ nullable: false, type: 'int' })
    quantity: number;

    @Column({ nullable: false, type: 'float' })
    totalPrice: number;

    @Column({ nullable: false, type: 'float' })
    unitPrice: number;

    @Column({ nullable: true, default: 'item' })
    purchaseMode: string;

    @Column({ nullable: true, type: 'int', default: 1 })
    itemsPerUnit: number;

    @Column({ nullable: true, type: 'text' })
    notes: string;

    @ManyToOne(() => Product, product => product?.quotationItems)
    product: Product;

    @ManyToOne(() => Quotation, quotation => quotation?.quotationItems)
    quotation: Quotation;

    @Column({
        nullable: false,
        default: () => 'CURRENT_TIMESTAMP'
    })
    createdAt: Date;

    @Column({
        nullable: false,
        default: () => 'CURRENT_TIMESTAMP',
        onUpdate: 'CURRENT_TIMESTAMP'
    })
    updatedAt: Date;
} 