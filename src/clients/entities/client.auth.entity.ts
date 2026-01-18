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

	@Column({ nullable: true })
	expoPushToken: string;

	@Column({ nullable: true })
	deviceId: string;

	@Column({ nullable: true })
	platform: string; // 'ios' | 'android'

	@Column({ type: 'timestamptz', nullable: true })
	pushTokenUpdatedAt: Date;

	@Column({ unique: true, nullable: true })
	clerkUserId: string; // Clerk user ID

	@Column({ type: 'timestamptz', nullable: true })
	clerkLastSyncedAt: Date; // Track last sync time

	@ManyToOne(() => Client, (client) => client?.portalCredentials, { nullable: false })
	client: Client;
}
