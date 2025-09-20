import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../user/entities/user.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Index } from 'typeorm';
import { Address } from 'src/lib/interfaces/address.interface';

@Entity('check-ins')
@Index(['owner', 'checkInTime']) // User check-in history
@Index(['client', 'checkInTime']) // Client visit tracking
@Index(['checkInTime', 'checkOutTime']) // Visit duration queries
@Index(['organisation', 'branch', 'checkInTime']) // Regional check-in reports
export class CheckIn {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'varchar', nullable: false })
	checkInTime: Date;

	@Column({ type: 'varchar', nullable: false })
	checkInPhoto: string;

	@Column({ type: 'varchar', nullable: false })
	checkInLocation: string;

	@Column({ type: 'varchar', nullable: true })
	checkOutTime: Date;

	@Column({ type: 'varchar', nullable: true })
	checkOutPhoto: string;

	@Column({ type: 'varchar', nullable: true })
	checkOutLocation: string;

	@Column({ type: 'varchar', nullable: true })
	duration: string;

	@Column({ type: 'json', nullable: true })
	fullAddress: Address;

	// Relations
	@ManyToOne(() => User, (user) => user?.checkIns)
	owner: User;

	@ManyToOne(() => Organisation, (organisation) => organisation?.assets, { nullable: true })
	organisation: Organisation;

	@ManyToOne(() => Branch, (branch) => branch?.assets, { nullable: true })
	branch: Branch;
    
	@ManyToOne(() => Client, (client) => client?.checkIns, { nullable: true })
	client: Client;
}
