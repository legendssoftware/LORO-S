import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { User } from '../../user/entities/user.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';

@Entity('asset')
export class Asset {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false })
	brand: string;

	@Column({ nullable: false, unique: true })
	serialNumber: string;

	@Column({ nullable: false })
	modelNumber: string;

	@Column({ nullable: false })
	purchaseDate: Date;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ nullable: false })
	hasInsurance: boolean;

	@Column({ nullable: false })
	insuranceProvider: string;

	@Column({ nullable: false })
	insuranceExpiryDate: Date;

	@Column({ nullable: false })
	isDeleted: boolean;

	@ManyToOne(() => User, (user) => user?.assets)
	@JoinColumn({ name: 'ownerClerkUserId', referencedColumnName: 'clerkUserId' })
	owner: User;

	@Column({ nullable: true })
	ownerClerkUserId: string;

	@ManyToOne(() => Organisation, (organisation) => organisation?.assets, { nullable: true })
	@JoinColumn({ name: 'organisationUid' })
	org: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@ManyToOne(() => Branch, (branch) => branch?.assets, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;
}
