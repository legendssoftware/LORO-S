import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { ApiProperty } from '@nestjs/swagger';

export enum WarningSeverity {
	LOW = 'LOW',
	MEDIUM = 'MEDIUM',
	HIGH = 'HIGH',
}

export enum WarningStatus {
	ACTIVE = 'ACTIVE',
	EXPIRED = 'EXPIRED',
	REVOKED = 'REVOKED',
}

@Entity()
export class Warning {
	@ApiProperty({
		description: 'Unique identifier for the warning',
		example: 1,
	})
	@PrimaryGeneratedColumn()
	uid: number;

	@ApiProperty({
		description: 'User who received the warning',
		example: { uid: 1, username: 'johndoe' },
		type: () => User,
	})
	@ManyToOne(() => User, { eager: true })
	owner: User;

	@ApiProperty({
		description: 'User who issued the warning',
		example: { uid: 2, username: 'admin' },
		type: () => User,
	})
	@ManyToOne(() => User, { eager: true })
	issuedBy: User;

	@ApiProperty({
		description: 'Reason for issuing the warning',
		example: 'Failure to meet performance standards',
	})
	@Column()
	reason: string;

	@ApiProperty({
		description: 'Severity level of the warning',
		enum: WarningSeverity,
		example: WarningSeverity.MEDIUM,
	})
	@Column({
		type: 'enum',
		enum: WarningSeverity,
		default: WarningSeverity.LOW,
	})
	severity: WarningSeverity;

	@ApiProperty({
		description: 'Date when the warning was issued',
		example: '2023-05-15T10:30:00Z',
	})
	@CreateDateColumn()
	issuedAt: Date;

	@ApiProperty({
		description: 'Date when the warning expires',
		example: '2023-11-15T10:30:00Z',
	})
	@Column({ type: 'timestamp' })
	expiresAt: Date;

	@ApiProperty({
		description: 'Flag indicating if the warning is expired',
		example: false,
	})
	@Column({ default: false })
	isExpired: boolean;

	@ApiProperty({
		description: 'Date when the warning record was created',
		example: '2023-05-15T10:30:00Z',
	})
	@CreateDateColumn()
	createdAt: Date;

	@ApiProperty({
		description: 'Date when the warning record was last updated',
		example: '2023-05-15T10:30:00Z',
	})
	@UpdateDateColumn()
	updatedAt: Date;

	@ApiProperty({ 
		description: 'Status of the warning', 
		enum: WarningStatus, 
		example: WarningStatus.ACTIVE 
	})
	@Column({
		type: 'enum',
		enum: WarningStatus,
		default: WarningStatus.ACTIVE,
	})
	status: WarningStatus;
}
