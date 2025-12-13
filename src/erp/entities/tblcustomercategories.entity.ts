import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ERP Customer Categories Entity
 * Maps to tblcustomercategories table in ERP database
 * IMPORTANT: synchronize: false - Never sync with ERP database
 * 
 * Index: idx_customercategories_catcode already exists in database
 */
@Entity('tblcustomercategories')
export class TblCustomerCategories {
	@PrimaryGeneratedColumn()
	ID: number;

	@Column({ type: 'varchar', length: 10, nullable: true })
	cust_cat_code: string;

	@Column({ type: 'varchar', length: 100, nullable: true })
	cust_cat_description: string;
}

