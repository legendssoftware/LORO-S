import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceStatus, DeviceType } from '../../lib/enums/iot';
import { Branch } from '../../branch/entities/branch.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';

@Entity('device')
export class Device {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ nullable: false })
	orgID: number;

	@Column({ nullable: false })
	branchID: number;

	@ManyToOne(() => Branch, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@Column({ nullable: false})
	deviceID: string;

	@Column({ nullable: false, type: 'enum', enum: DeviceType, default: DeviceType.DOOR_SENSOR })
	deviceType: DeviceType;

	@Column({ nullable: false })
	deviceIP: string;

	@Column({ nullable: false })
	devicePort: number;

	@Column({ nullable: false })
	devicLocation: string;

	@Column({ nullable: false })
	deviceTag: string;

	@Column({ nullable: false, type: 'enum', enum: DeviceStatus, default: DeviceStatus.ONLINE })
	currentStatus: DeviceStatus;

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@Column({ nullable: false, default: false })
	isDeleted: boolean;

	@Column({ nullable: false, type: 'json' })
	analytics: {
		openCount: number;
		closeCount: number;
		totalCount: number;
		lastOpenAt: Date;
		lastCloseAt: Date;
		onTimeCount: number;
		lateCount: number;
		daysAbsent: number;
	};

	@OneToMany(() => DeviceRecords, (records) => records.device)
	records: DeviceRecords[];

	@OneToMany(() => DeviceLogs, (logs) => logs.device)
	logs: DeviceLogs[];

	@ManyToOne(() => Organisation, { nullable: true })
	organisation: Organisation;
}

@Entity('device_records')
export class DeviceRecords {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'timestamptz', nullable: true })
	openTime: Date;

	@Column({ type: 'timestamptz', nullable: true })
	closeTime: Date;

	@Column({ nullable: false })
	deviceId: number;

	@ManyToOne(() => Device, (device) => device.records)
	device: Device;

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;
}

@Entity('device_logs')
export class DeviceLogs {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ name: 'device_id', nullable: true })
	deviceId: number;

	@Column({ name: 'device_identifier', nullable: false })
	deviceID: string;

	@Column({ name: 'org_id', nullable: true })
	orgID: number;

	@Column({ name: 'branch_id', nullable: true })
	branchID: number;

	@Column({ nullable: false })
	eventType: string; // 'open' or 'close'

	@Column({ nullable: false })
	ipAddress: string;

	@Column({ nullable: true, type: 'varchar', length: 500 })
	userAgent: string;

	@Column({ nullable: true, type: 'json' })
	networkInfo: {
		ipAddress?: string;
		port?: number;
		headers?: Record<string, string>;
		userAgent?: string;
		referer?: string;
	};

	@Column({ nullable: false })
	queryTimeMs: number; // Time taken for the query

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	timestamp: Date; // Event timestamp

	@Column({ nullable: true, type: 'json' })
	metadata: Record<string, any>;

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@ManyToOne(() => Device, { nullable: true })
	@JoinColumn({ name: 'device_id' })
	device: Device;
}
