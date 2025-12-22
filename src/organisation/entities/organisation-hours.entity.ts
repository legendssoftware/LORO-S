import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Organisation } from './organisation.entity';

// Migration SQL (run this to update existing database):
/*
ALTER TABLE organisation_hours 
ADD COLUMN schedule JSON NULL,
ADD COLUMN timezone VARCHAR(50) NULL,
ADD COLUMN holidayMode BOOLEAN DEFAULT FALSE,
ADD COLUMN holidayUntil TIMESTAMP NULL;
*/

@Entity()
export class OrganisationHours {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ unique: true, nullable: false })
	ref: string;

	@Column({ type: 'timestamptz', nullable: true })
	openTime?: Date;

	@Column({ type: 'timestamptz', nullable: true })
	closeTime?: Date;

	@Column({ type: 'json' })
	weeklySchedule: {
		monday: boolean;
		tuesday: boolean;
		wednesday: boolean;
		thursday: boolean;
		friday: boolean;
		saturday: boolean;
		sunday: boolean;
	};

	@Column({ type: 'json', nullable: true })
	schedule?: {
		monday: { start: string; end: string; closed: boolean };
		tuesday: { start: string; end: string; closed: boolean };
		wednesday: { start: string; end: string; closed: boolean };
		thursday: { start: string; end: string; closed: boolean };
		friday: { start: string; end: string; closed: boolean };
		saturday: { start: string; end: string; closed: boolean };
		sunday: { start: string; end: string; closed: boolean };
	};

	@Column({ type: 'varchar', length: 50, nullable: true })
	timezone?: string;

	@Column({ type: 'boolean', default: false })
	holidayMode: boolean;

	@Column({ type: 'timestamptz', nullable: true })
	holidayUntil?: Date;

	@Column({ type: 'json', nullable: true })
	specialHours?: {
		date: string;
		openTime: string;
		closeTime: string;
		reason?: string;
	}[];

	@Column({ default: false })
	isDeleted: boolean;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@ManyToOne(() => Organisation, (organisation) => organisation.hours)
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column()
	organisationUid: number;
}
