import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Client } from './client.entity';

@Entity('client_auth')
export class ClientAuth {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false, unique: true })
	email: string;

	@Column({ nullable: false })
	password: string;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	lastLogin: Date;

	@Column({ nullable: false, default: false })
	isActive: boolean;

	@Column({ nullable: false, default: false })
	isDeleted: boolean;

	@ManyToOne(() => Client, (client) => client?.portalCredentials, { nullable: false })
	client: Client;
}
