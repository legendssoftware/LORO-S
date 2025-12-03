import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceStatus, DeviceType } from '../../lib/enums/iot';
import { Branch } from '../../branch/entities/branch.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';

@Entity('device')
@Index(['deviceID'])
@Index(['createdAt'])
@Index(['updatedAt'])
export class Device {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => Branch, { nullable: true })
	@JoinColumn({ name: 'branchId' })
	branch: Branch;

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

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
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

	@ManyToOne(() => Organisation, { nullable: true })
	@JoinColumn({ name: 'orgId' })
	organisation: Organisation;
}

@Entity('device_records')
@Index(['deviceId'])
@Index(['openTime'])
@Index(['closeTime'])
@Index(['createdAt'])
@Index(['updatedAt'])
export class DeviceRecords {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ nullable: true })
	openTime: Date;

	@Column({ nullable: true })
	closeTime: Date;

	@Column({ nullable: false })
	deviceId: number;

	@ManyToOne(() => Device, (device) => device.records)
	device: Device;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;
}
