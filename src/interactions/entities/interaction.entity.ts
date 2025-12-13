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

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn()
	createdBy: User;

	@ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
	@JoinColumn()
	organisation: Organisation;

	@ManyToOne(() => Branch, { onDelete: 'CASCADE' })
	@JoinColumn()
	branch: Branch;

	@ManyToOne(() => Lead, (lead) => lead.interactions, { nullable: true })
	@JoinColumn()
	lead: Lead;

	@ManyToOne(() => Client, (client) => client.interactions, { nullable: true })
	@JoinColumn()
	client: Client;

	@ManyToOne(() => Quotation, (quotation) => quotation.interactions, { nullable: true })
	@JoinColumn()
	quotation: Quotation;
}
