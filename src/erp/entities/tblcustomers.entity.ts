import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ERP Customers Entity
 * Maps to tblcustomers table in ERP database
 * IMPORTANT: synchronize: false - Never sync with ERP database
 * 
 * Indexes: idx_customers_code_store and idx_customers_category already exist in database
 */
@Entity('tblcustomers')
export class TblCustomers {
	@PrimaryGeneratedColumn()
	ID: number;

	@Column({ type: 'varchar', length: 100, nullable: true })
	Code: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	Description: string;

	@Column({ type: 'varchar', length: 3, default: '001', nullable: true })
	Category: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance06: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance07: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance08: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance09: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance10: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance11: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance12: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Balance13: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal06: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal07: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal08: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal09: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal10: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal11: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal12: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastBal13: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal06: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal07: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal08: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal09: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal10: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal11: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal12: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	SalesBal13: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal06: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal07: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal08: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal09: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal10: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal11: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal12: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	LastSalesBal13: number;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	Address01: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	Address02: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	Address03: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	Address04: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	Address05: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	Address06: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	Address07: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	Address08: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	Address09: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress1: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress2: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress3: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress4: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress5: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress6: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress7: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress8: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	PhysicalAddress9: string;

	@Column({ type: 'varchar', length: 3, default: '', nullable: true })
	TaxCode: string;

	@Column({ type: 'varchar', length: 3, default: '', nullable: true })
	DiscountType: string;

	@Column({ type: 'tinyint', default: 0, nullable: true })
	Blocked: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Discount: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	Creditlimit: number;

	@Column({ type: 'varchar', length: 3, default: '001', nullable: true })
	PriceRegime: string;

	@Column({ type: 'varchar', length: 20, default: '', nullable: true })
	Cellphone: string;

	@Column({ type: 'varchar', length: 20, default: '', nullable: true })
	Tel: string;

	@Column({ type: 'varchar', length: 20, default: '', nullable: true })
	Fax: string;

	@Column({ type: 'varchar', length: 500, default: '', nullable: true })
	Email: string;

	@Column({ type: 'varchar', length: 20, default: '', nullable: true })
	TaxRef: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	UserDefined1: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	UserDefined2: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	UserDefined3: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	UserDefined4: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	UserDefined5: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	UserDefined6: string;

	@Column({ type: 'enum', enum: ['Y', 'N'], default: 'N' })
	Freight: string;

	@Column({ type: 'enum', enum: ['Y', 'N'], default: 'N' })
	Ship: string;

	@Column({ type: 'date', default: '2000-01-01', nullable: true })
	UpdatedOn: Date;

	@Column({ type: 'int', default: 0, nullable: true })
	CashAccount: number;

	@Column({ type: 'int', default: 0, nullable: true })
	DocPrint: number;

	@Column({ type: 'varchar', length: 45, default: ' ', nullable: true })
	DocContact: string;

	@Column({ type: 'int', default: 0, nullable: true })
	StatePrint: number;

	@Column({ type: 'varchar', length: 45, default: ' ', nullable: true })
	StateContact: string;

	@Column({ type: 'decimal', precision: 65, scale: 2, default: 0.0, nullable: true })
	balance: number;

	@Column({ type: 'varchar', length: 3, default: '001', nullable: true })
	Store: string;

	@Column({ type: 'int', default: 0, nullable: true })
	Posted: number;

	@Column({ type: 'varchar', length: 5000, default: '', nullable: true })
	notes: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	SalesRep: string;

	@Column({ type: 'int', default: 0, nullable: true })
	Incl: number;

	@Column({ type: 'int', default: 0, nullable: true })
	Status: number;

	@Column({ type: 'enum', enum: ['Y', 'N'], default: 'N', nullable: true })
	EmailDoc: string;

	@Column({ type: 'varchar', length: 3, default: '001', nullable: true })
	discount_type: string;

	@Column({ type: 'int', default: 0, nullable: true })
	on_hold: number;

	@Column({ type: 'int', default: 0, nullable: true })
	open_item: number;

	@Column({ type: 'varchar', length: 60, default: '', nullable: true })
	CustomerName: string;

	@Column({ type: 'varchar', length: 545, default: '', nullable: true })
	VatNumber: string;

	@Column({ type: 'date', default: '1970-01-01', nullable: true })
	Birthday: Date;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	Title: string;

	@Column({ type: 'tinyint', default: 0, nullable: true })
	LayBye: number;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	RegNumber: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	OrderNumber: string;

	@Column({ type: 'varchar', length: 45, default: '000', nullable: true })
	terms: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	PhysicalAddress06: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	PhysicalAddress07: string;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	PhysicalAddress08: string;

	@Column({ type: 'int', default: 0, nullable: true })
	t1: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t2: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t3: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t4: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t5: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t6: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t7: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t8: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t9: number;

	@Column({ type: 'int', default: 0, nullable: true })
	t10: number;

	@Column({ type: 'int', default: 1, nullable: true })
	approved: number;

	@Column({ type: 'varchar', length: 50, default: '', nullable: true })
	reference: string;

	@Column({ type: 'varchar', length: 10, default: '001', nullable: true })
	job_tile: string;

	@Column({ type: 'date', default: '2000-01-01', nullable: true })
	birth_day: Date;

	@Column({ type: 'int', default: 0, nullable: true })
	hide_credit_limit: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	open_balance: number;

	@Column({ type: 'varchar', length: 3, default: 'P01', nullable: true })
	PromoCode: string;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	bale: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	pack: number;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	supportNr: string;

	@Column({ type: 'date', default: '2000-01-01', nullable: true })
	last_sale_date: Date;

	@Column({ type: 'varchar', length: 1000, default: 'Contractor', nullable: true })
	category_type: string;

	@Column({ type: 'date', default: '2000-01-01', nullable: true })
	paidto: Date;

	@Column({ type: 'tinyint', default: 0, nullable: true })
	enabled: number;

	@Column({ type: 'varchar', length: 245, default: '', nullable: true })
	supportpackage: string;

	@Column({ type: 'tinyint', default: 0, nullable: true })
	support: number;

	@Column({ type: 'varchar', length: 45, default: '0', nullable: true })
	nrofdevices: string;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis01: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis02: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis03: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis04: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis05: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis06: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis07: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis08: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis09: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis10: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis11: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis12: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateThis13: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast01: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast02: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast03: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast04: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast05: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast06: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast07: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast08: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast09: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast10: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast11: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast12: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRateLast13: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	BalanceRate: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis01: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis02: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis03: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis04: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis05: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis06: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis07: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis08: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis09: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis10: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis11: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis12: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRateThis13: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast01: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast02: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast03: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast04: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast05: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast06: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast07: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast08: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast09: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast10: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast11: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast12: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	SaleBalanceRatelast13: number;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	ck_number: string;

	@Column({ type: 'date', default: '2000-01-01', nullable: true })
	first_sale_date: Date;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	crm_uid: string;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	cgic_fee: number;

	@Column({ type: 'decimal', precision: 60, scale: 3, default: 0.0, nullable: true })
	max_discount: number;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	first_name: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	last_name: string;

	@Column({ type: 'varchar', length: 45, default: 'Male', nullable: true })
	gender: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	ethnicity: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	id_number: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	employment_status: string;

	@Column({ type: 'varchar', length: 100, default: '', nullable: true })
	loyalty_tier: string;

	@Column({ type: 'varchar', length: 45, default: 'Email', nullable: true })
	contact_method: string;
}

