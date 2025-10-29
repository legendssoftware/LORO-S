import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ERP Sales Header Entity
 * Maps to tblsalesheader table in ERP database
 * IMPORTANT: synchronize: false - Never sync with ERP database
 */
@Entity('tblsalesheader')
export class TblSalesHeader {
	@PrimaryGeneratedColumn()
	ID: number;

	@Column({ type: 'varchar', length: 500, nullable: true })
	doc_number: string;

	@Column({ type: 'varchar', length: 3, nullable: true })
	till_num: string;

	@Column({ type: 'varchar', length: 100, nullable: true })
	user_id: string;

	@Column({ type: 'int', default: 0, nullable: true })
	shift_num: number;

	@Column({ type: 'int', nullable: true })
	doc_type: number;

	@Column({ type: 'varchar', length: 20, nullable: true })
	doc_desc: string;

	@Column({ type: 'date', nullable: true })
	sale_date: Date;

	@Column({ type: 'time', nullable: true })
	sale_time: string;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	total_incl: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	disc_percent: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	discount: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	total_tax: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	change_amnt: number;

	@Column({ type: 'varchar', length: 10, default: '', nullable: true })
	customer: string;

	@Column({ type: 'varchar', length: 10, default: '', nullable: true })
	sales_code: string;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0 })
	total_tender: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	cash: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	credit_card: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	eft: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	debit_card: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	cheque: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	voucher: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	account: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	snap_scan: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	zapper: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	extra: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	offline_card: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	fnb_qr: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	round_variance: number;

	@Column({ type: 'varchar', length: 500, default: '', nullable: true })
	CC_detail: string;

	@Column({ type: 'varchar', length: 500, default: '', nullable: true })
	DC_detail: string;

	@Column({ type: 'varchar', length: 500, default: '', nullable: true })
	CQ_detail: string;

	@Column({ type: 'int', default: 0, nullable: true })
	import_status: number;

	@Column({ type: 'int', default: 0, nullable: true })
	cashed_up: number;

	@Column({ type: 'varchar', length: 3, default: '001', nullable: true })
	store: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	delivery_1: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	delivery_2: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	delivery_3: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	delivery_4: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	delivery_5: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	contact_name: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	customer_VAT_reg: string;

	@Column({ type: 'int', default: 0, nullable: true })
	delivery_status: number;

	@Column({ type: 'datetime', nullable: true })
	delivery_date: Date;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	total_cost: number;

	@Column({ type: 'varchar', length: 15, default: '', nullable: true })
	supplier_num: string;

	@Column({ type: 'varchar', length: 150, default: '', nullable: true })
	reference_1: string;

	@Column({ type: 'varchar', length: 150, default: '', nullable: true })
	reference_2: string;

	@Column({ type: 'int', default: 0, nullable: true })
	printed: number;

	@Column({ type: 'varchar', length: 20, default: '', nullable: true })
	deliveryTel: string;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	disc_per: number;

	@Column({ type: 'int', default: 0, nullable: true })
	excl_invoice: number;

	@Column({ type: 'varchar', length: 45, default: '001', nullable: true })
	tax_code: string;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	discount_per: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	Over_Tendered: number;

	@Column({ type: 'int', default: 0, nullable: true })
	Paid: number;

	@Column({ type: 'int', default: 0, nullable: true })
	DI: number;

	@Column({ type: 'int', default: 0, nullable: true })
	crm: number;

	@Column({ type: 'tinyint', default: 0, nullable: true })
	isSpecial: number;

	@Column({ type: 'date', nullable: true })
	date_edit: Date;

	@Column({ type: 'time', nullable: true })
	time_edit: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	gl_num: string;

	@Column({ type: 'int', default: 0, nullable: true })
	on_hold: number;

	@Column({ type: 'varchar', length: 5000, default: '', nullable: true })
	delivery_notes: string;

	@Column({ type: 'int', default: 0, nullable: true })
	ho_sales: number;

	@Column({ type: 'int', default: 0, nullable: true })
	approved: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	weight_total: number;

	@Column({ type: 'varchar', length: 3, default: '001', nullable: true })
	currency_code: string;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 1.0, nullable: true })
	exchange_rate: number;

	@Column({ type: 'int', default: 0, nullable: true })
	invoice_used: number;

	@Column({ type: 'int', default: 0, nullable: true })
	count_num: number;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	Reprinted_By: string;

	@Column({ type: 'int', default: 0, nullable: true })
	view_quote: number;

	@Column({ type: 'decimal', precision: 19, scale: 3, default: 0.0, nullable: true })
	items_total: number;

	@Column({ type: 'int', default: 0, nullable: true })
	to_till: number;

	@Column({ type: 'int', default: 0, nullable: true })
	to_till1: number;

	@Column({ type: 'int', default: 0, nullable: true })
	to_till2: number;

	@Column({ type: 'int', default: 0, nullable: true })
	to_till3: number;

	@Column({ type: 'int', default: 0, nullable: true })
	to_till4: number;

	@Column({ type: 'int', default: 0, nullable: true })
	to_till5: number;

	@Column({ type: 'varchar', length: 45, default: 'pending', nullable: true })
	status: string;

	@Column({ type: 'int', default: 0, nullable: true })
	error_send: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	int_tax: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	int_total: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	int_pay: number;

	@Column({ type: 'int', default: 0, nullable: true })
	open_status: number;

	// NOTE: smart_invoice column doesn't exist in the current database schema
	// Uncomment when this column is added to the database
	// @Column({ type: 'int', default: 0, nullable: true })
	// smart_invoice: number;
}

