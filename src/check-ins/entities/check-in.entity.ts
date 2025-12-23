import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../user/entities/user.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Address } from 'src/lib/interfaces/address.interface';

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

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;

	// Relations
	@ManyToOne(() => User, (user) => user?.checkIns)
	@JoinColumn({ name: 'ownerUid' })
	owner: User;

	@Column({ nullable: true })
	ownerUid: number;

	@ManyToOne(() => Organisation, (organisation) => organisation?.assets, { nullable: true })
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

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
}
