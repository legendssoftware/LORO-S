import { Branch } from 'src/branch/entities/branch.entity';
import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity('communication_logs')
export class CommunicationLog {
	@PrimaryGeneratedColumn('uuid')
	uid: string;

	@Column('varchar', { nullable: true })
	emailType: string;

	@Column('simple-array', { nullable: true })
	recipientEmails: string[];

	@Column('simple-array', { nullable: true })
	accepted: string[];

	@Column('simple-array', { nullable: true })
	rejected: string[];

	@Column({ nullable: true })
	messageId: string;

	@Column({ nullable: true })
	messageSize: number;

	@Column({ nullable: true })
	envelopeTime: number;

	@Column({ nullable: true })
	messageTime: number;

	@Column('json', { nullable: true })
	response: string;

	@Column('json', { nullable: true })
	envelope: {
		from: string;
		to: string[];
	};

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@ManyToOne(() => Branch, (branch) => branch?.communicationLogs)
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@ManyToOne(() => Organisation, (organisation) => organisation?.communicationLogs)
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;
}
