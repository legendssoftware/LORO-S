import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * ERP Sales Lines Entity
 * Maps to tblsaleslines table in ERP database
 * IMPORTANT: synchronize: false - Never sync with ERP database
 * 
 * Index: idx_saleslines_store_customer_date already exists in database
 */
@Entity('tblsaleslines')
@Index('idx_saleslines_store_customer_date', ['store', 'customer', 'sale_date', 'doc_type'])
export class TblSalesLines {
	@PrimaryGeneratedColumn()
	ID: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	discount: number;

	@Column({ type: 'varchar', length: 100, nullable: true })
	pay_type: string;

	@Column({ type: 'tinyint', default: 0, nullable: true })
	isSpecial: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	discount_perc: number;

	@Column({ type: 'varchar', length: 500, nullable: true })
	doc_number: string;

	@Column({ type: 'varchar', length: 100, nullable: true })
	item_code: string;

	@Column({ type: 'varchar', length: 5000, nullable: true })
	description: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	serialNumber: string;

	@Column({ type: 'varchar', length: 25, default: '', nullable: true })
	unit: string;

	@Column({ type: 'decimal', precision: 10, scale: 3, default: 0.0, nullable: true })
	quantity: number;

	@Column({ type: 'decimal', precision: 10, scale: 3, default: 0.0, nullable: true })
	excl_price: number;

	@Column({ type: 'decimal', precision: 10, scale: 3, default: 0.0, nullable: true })
	incl_price: number;

	@Column({ type: 'decimal', precision: 10, scale: 3, default: 0.0, nullable: true })
	tax: number;

	@Column({ type: 'decimal', precision: 10, scale: 3, default: 0.0, nullable: true })
	tax_per: number;

	@Column({ type: 'decimal', precision: 10, scale: 3, default: 0.0, nullable: true })
	incl_line_total: number;

	@Column({ type: 'varchar', length: 3, default: '001', nullable: true })
	store: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	deposit: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	total_incl_disc: number;

	@Column({ type: 'date', nullable: true })
	sale_date: Date;

	@Column({ type: 'varchar', length: 10, default: '' })
	deliver: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	cost_price: number;

	@Column({ type: 'varchar', length: 10, default: '001', nullable: true })
	tax_type: string;

	@Column({ type: 'varchar', length: 10, default: '', nullable: true })
	rep_code: string;

	@Column({ type: 'varchar', length: 20, nullable: true })
	doc_type: string;

	@Column({ type: 'time', nullable: true })
	sale_time: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	customer: string;

	@Column({ type: 'varchar', length: 200, default: '', nullable: true })
	category: string;

	@Column({ type: 'varchar', length: 20, default: '0', nullable: true })
	lot_item: string;

	@Column({ type: 'varchar', length: 10, default: '01', nullable: true })
	period: string;

	@Column({ type: 'varchar', length: 1, default: 'I', nullable: true })
	type: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	net_mass: number;

	@Column({ type: 'int', default: -1, nullable: true })
	status: number;

	@Column({ type: 'int', default: 1, nullable: true })
	link: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	link_qty: number;

	@Column({ type: 'int', default: 0, nullable: true })
	DI: number;

	@Column({ type: 'int', default: 0, nullable: true })
	ho_sales: number;

	@Column({ type: 'decimal', precision: 10, scale: 3, default: 0.0, nullable: true })
	qty_left: number;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	DocLinked: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	main_item: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	supplier: string;

	@Column({ type: 'date', nullable: true })
	edit_date: Date;

	@Column({ type: 'time', nullable: true })
	edit_time: string;

	@Column({ type: 'int', default: 0, nullable: true })
	smart: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	int_line_excl: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	int_line_incl: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	int_line_tax: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	int_line_total: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 1.0, nullable: true })
	exchange_rate_line: number;

	@Column({ type: 'int', default: 0, nullable: true })
	commission_item: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	commission_per: number;
}

