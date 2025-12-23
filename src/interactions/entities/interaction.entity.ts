import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { Client } from '../../clients/entities/client.entity';
import { InteractionType } from '../../lib/enums/interaction.enums';
import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from 'src/branch/entities/branch.entity';
import { Quotation } from '../../shop/entities/quotation.entity';

@Entity('interactions')
export class Interaction {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false })
	message: string;

	@Column({ nullable: true })
	attachmentUrl: string;

	@Column({ type: 'enum', enum: InteractionType, default: InteractionType.MESSAGE })
	type: InteractionType;

	@Column({ type: 'boolean', default: false })
	isDeleted: boolean;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'createdByUid' })
	createdBy: User;

	@Column({ nullable: true })
	createdByUid: number;

	@ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@ManyToOne(() => Branch, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@ManyToOne(() => Lead, (lead) => lead.interactions, { nullable: true })
	@JoinColumn({ name: 'leadUid' })
	lead: Lead;

	@Column({ nullable: true })
	leadUid: number;

	@ManyToOne(() => Client, (client) => client.interactions, { nullable: true })
	@JoinColumn({ name: 'clientUid' })
	client: Client;

	@Column({ nullable: true })
	clientUid: number;

	@ManyToOne(() => Quotation, (quotation) => quotation.interactions, { nullable: true })
	@JoinColumn({ name: 'quotationUid' })
	quotation: Quotation;

	@Column({ nullable: true })
	quotationUid: number;
}
