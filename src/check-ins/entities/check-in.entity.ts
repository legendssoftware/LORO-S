import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../user/entities/user.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Address } from 'src/lib/interfaces/address.interface';
import { Quotation } from '../../shop/entities/quotation.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { OrderStatus } from '../../lib/enums/status.enums';
import { Industry } from '../../lib/enums/lead.enums';

@Entity('check-ins')
export class CheckIn {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	checkInTime: Date;

	@Column({ type: 'varchar', nullable: false })
	checkInPhoto: string;

	@Column({ type: 'varchar', nullable: false })
	checkInLocation: string;

	@Column({ type: 'timestamptz', nullable: true })
	checkOutTime: Date;

	@Column({ type: 'varchar', nullable: true })
	checkOutPhoto: string;

	@Column({ type: 'varchar', nullable: true })
	checkOutLocation: string;

	@Column({ type: 'varchar', nullable: true })
	duration: string;

	@Column({ type: 'json', nullable: true })
	fullAddress: Address;

	@Column({ type: 'text', nullable: true })
	notes: string;

	@Column({ type: 'text', nullable: true })
	resolution: string;

	@Column({ type: 'text', nullable: true })
	followUp: string;

	// Contact Information Fields
	@Column({ type: 'varchar', nullable: true })
	contactFullName: string;

	@Column({ type: 'varchar', nullable: true })
	contactImage: string;

	@Column({ type: 'varchar', nullable: true })
	contactCellPhone: string;

	@Column({ type: 'varchar', nullable: true })
	contactLandline: string;

	@Column({ type: 'varchar', nullable: true })
	contactEmail: string;

	@Column({ type: 'json', nullable: true })
	contactAddress: Address;

	// Company and Business Information Fields
	@Column({ type: 'varchar', nullable: true })
	companyName: string;

	@Column({ type: 'enum', enum: Industry, nullable: true })
	businessType: Industry;

	@Column({ type: 'varchar', nullable: true })
	personSeenPosition: string;

	@Column({ type: 'varchar', nullable: true })
	meetingLink: string;

	// Sales and Quotation Fields
	@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
	salesValue: number;

	@Column({ type: 'varchar', nullable: true })
	quotationNumber: string;

	@Column({ type: 'enum', enum: OrderStatus, nullable: true })
	quotationStatus: OrderStatus;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;

	// Relations
	@ManyToOne(() => User, (user) => user?.checkIns)
	@JoinColumn({ name: 'ownerClerkUserId', referencedColumnName: 'clerkUserId' })
	owner: User;

	@Column({ nullable: true })
	ownerClerkUserId: string;

	@ManyToOne(() => Organisation, (organisation) => organisation?.assets, { nullable: true })
	@JoinColumn({ name: 'organisationUid', referencedColumnName: 'clerkOrgId' })
	organisation: Organisation;

	@Column({ type: 'varchar', nullable: true })
	organisationUid: string;

	@ManyToOne(() => Branch, (branch) => branch?.assets, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;
    
	@ManyToOne(() => Client, (client) => client?.checkIns, { nullable: true })
	@JoinColumn({ name: 'clientUid' })
	client: Client;

	@Column({ nullable: true })
	clientUid: number;

	@ManyToOne(() => Quotation, { nullable: true })
	@JoinColumn({ name: 'quotationUid' })
	quotation: Quotation;

	@Column({ nullable: true })
	quotationUid: number;

	@ManyToOne(() => Lead, { nullable: true })
	@JoinColumn({ name: 'leadUid' })
	lead: Lead;

	@Column({ nullable: true })
	leadUid: number;

	// New check-in enhancement fields
	@Column({ type: 'varchar', nullable: true })
	methodOfContact: string;

	@Column({ type: 'varchar', nullable: true })
	buildingType: string;

	@Column({ type: 'boolean', default: false })
	contactMade: boolean;
}
