import { Product } from '../../products/entities/product.entity';
import { ResellerStatus } from '../../lib/enums/product.enums';
import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from 'src/branch/entities/branch.entity';
import { Column, Entity, PrimaryGeneratedColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';

@Entity('reseller')
export class Reseller {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false, length: 100, type: 'varchar' })
	name: string;

	@Column({ nullable: false, length: 100, type: 'varchar' })
	description: string;

	@Column({ nullable: false, length: 100, type: 'varchar' })
	logo: string;

	@Column({ nullable: false, length: 100, type: 'varchar' })
	website: string;

	@Column({ nullable: false, type: 'enum', enum: ResellerStatus, default: ResellerStatus.ACTIVE })
	status: ResellerStatus;

	@Column({ nullable: false, length: 100, type: 'varchar' })
	contactPerson: string;

	@Column({ nullable: false, length: 100, type: 'varchar' })
	phone: string;

	@Column({ nullable: false, length: 100, type: 'varchar' })
	email: string;

	@Column({
		nullable: false,
		default: () => 'CURRENT_TIMESTAMP',
	})
	createdAt: Date;

	@Column({
		nullable: false,
		default: () => 'CURRENT_TIMESTAMP',
		onUpdate: 'CURRENT_TIMESTAMP',
	})
	updatedAt: Date;

	@Column({ nullable: false, default: false })
	isDeleted: boolean;

	@Column({ nullable: false, type: 'json' })
	address: {
		street: string;
		city: string;
		state: string;
		country: string;
		postalCode: string;
	};

	// Relations
	@OneToMany(() => Product, (product) => product?.reseller)
	products: Product[];

	@ManyToOne(() => Organisation, (organisation) => organisation?.resellers, { nullable: true })
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@ManyToOne(() => Branch, (branch) => branch?.resellers, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;
}
