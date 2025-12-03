import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * ERP Multistore Entity
 * Maps to tblmultistore table in ERP database
 * IMPORTANT: synchronize: false - Never sync with ERP database
 * 
 * This table contains store/branch information for each country
 */
@Entity('tblmultistore')
@Index('idx_multistore_code', ['code'])
export class TblMultistore {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code: string;

	@Column({ type: 'varchar', length: 500, nullable: true })
	description: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_1: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_2: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_3: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_4: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_5: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_6: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_7: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	address_8: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	tel: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	cell: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	email: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	tax_invoice: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	credit_note: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	quotation: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	sales_order: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	purchase_order: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	supplier_invoice: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	grn: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	returndebit: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	payout: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	proforma: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	Info1: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	Info2: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	Info3: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	Info4: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	Info5: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_1: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_2: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_3: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_4: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_5: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_6: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_7: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_8: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_9: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_10: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_11: string;

	@Column({ type: 'text', nullable: true })
	BankDetails: string;

	@Column({ type: 'text', nullable: true })
	Message1: string;

	@Column({ type: 'text', nullable: true })
	Message2: string;

	@Column({ type: 'text', nullable: true })
	Message3: string;

	@Column({ type: 'varchar', length: 10, nullable: true })
	CurrencySymbol: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	code_12: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	BOMCode: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	interStore: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	Status: string;

	@Column({ type: 'varchar', length: 10, nullable: true })
	BaseCurrency: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	systemCulture: string;

	@Column({ type: 'int', nullable: true })
	currencyNumber: number;

	@Column({ type: 'varchar', length: 200, nullable: true })
	alias: string;

	@Column({ type: 'tinyint', nullable: true })
	is_alias: number;

	@Column({ type: 'tinyint', nullable: true })
	foreign: number;

	@Column({ type: 'tinyint', nullable: true })
	flag: number;

	@Column({ type: 'varchar', length: 50, nullable: true })
	country: string;

	@Column({ type: 'tinyint', nullable: true })
	disabled: number;

	@Column({ type: 'varchar', length: 50, nullable: true })
	category: string;
}

