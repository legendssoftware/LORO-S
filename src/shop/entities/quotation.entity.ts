import { Client } from '../../clients/entities/client.entity';
import { QuotationItem } from './quotation-item.entity';
import { OrderStatus } from '../../lib/enums/status.enums';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	OneToMany,
	JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Interaction } from '../../interactions/entities/interaction.entity';
import { Project } from './project.entity';

@Entity('quotation')
export class Quotation {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ unique: true, nullable: false })
	quotationNumber: string;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	totalAmount: number;

	@Column()
	totalItems: number;

	@Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.DRAFT })
	status: OrderStatus;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	quotationDate: Date;

	@ManyToOne(() => User, { eager: true })
	placedBy: User;

	@ManyToOne(() => Client, { eager: true })
	client: Client;

	@OneToMany(() => QuotationItem, (quotationItem) => quotationItem.quotation, { eager: true, cascade: true })
	quotationItems: QuotationItem[];

	@Column({ nullable: true })
	shippingMethod: string;

	@Column({ nullable: true })
	notes: string;

	@Column({ nullable: true })
	shippingInstructions: string;

	@Column({ nullable: true })
	packagingRequirements: string;

	@Column({ nullable: true })
	priceListType: string;

	@Column({ nullable: true })
	title: string;

	@Column({ nullable: true, type: 'text' })
	description: string;

	@ManyToOne(() => User, { nullable: true })
	reseller: User;

	@Column({ nullable: true })
	promoCode: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
	resellerCommission: number;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;

	@Column({ type: 'timestamptz', nullable: true })
	validUntil: Date;

	@Column({ nullable: true })
	reviewToken: string;

	@Column({ nullable: true })
	reviewUrl: string;

	@Column({ nullable: true })
	pdfURL: string;

	// Currency information
	@Column({ nullable: true, length: 6, default: 'ZAR' })
	currency: string;

	// Conversion tracking
	@Column({ default: false })
	isConverted: boolean;

	@Column({ type: 'timestamptz', nullable: true })
	convertedAt: Date;

	@Column({ nullable: true })
	convertedBy: number;

	@OneToMany(() => Order, (order) => order.quotation)
	orders: Order[];

	// Relations
	@ManyToOne(() => Branch, (branch) => branch?.quotations, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@ManyToOne(() => Organisation, (organisation) => organisation?.quotations, { nullable: true })
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@OneToMany(() => Interaction, (interaction) => interaction.quotation)
	interactions: Interaction[];

	@ManyToOne(() => Project, (project) => project.quotations, { nullable: true })
	@JoinColumn({ name: 'projectUid' })
	project: Project;

	@Column({ nullable: true })
	projectUid: number;
}
