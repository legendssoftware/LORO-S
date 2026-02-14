import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { User } from '../../user/entities/user.entity';
import { Report } from '../../reports/entities/report.entity';
import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, OneToOne, JoinColumn, Index } from 'typeorm';
import { BreakDetail } from '../../lib/interfaces/break-detail.interface';
import { Address } from 'src/lib/interfaces/address.interface';

@Entity('attendance')
@Index(['ownerClerkUserId', 'status', 'checkOut'], { where: '"checkOut" IS NULL' })
@Index(['organisationUid', 'checkIn'])
@Index(['branchUid'], { where: '"branchUid" IS NOT NULL' })
@Index(['checkIn'], { where: '"checkIn" IS NOT NULL' })
@Index(['status', 'checkIn'])
export class Attendance {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({
		type: 'enum',
		enum: AttendanceStatus,
		default: AttendanceStatus.PRESENT,
	})
	status: AttendanceStatus;

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	checkIn: Date;

	@Column({ type: 'timestamptz', nullable: true })
	checkOut: Date;

	@Column({ type: 'varchar', nullable: true })
	duration: string;

	@Column({ type: 'varchar', nullable: true })
	overtime: string;

	@Column({ type: 'int', nullable: true, default: 0 })
	earlyMinutes: number;

	@Column({ type: 'int', nullable: true, default: 0 })
	lateMinutes: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	checkInLatitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	checkInLongitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	checkOutLatitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	checkOutLongitude: number;

	@Column({ type: 'json', nullable: true })
	placesOfInterest: {
		startAddress: Address;
		endAddress: Address;
		breakStart: Address;
		breakEnd: Address;
		otherPlacesOfInterest: {
			address: Address;
			notes: string;
		}[];
	};

	@Column({ type: 'text', nullable: true })
	checkInNotes: string;

	@Column({ type: 'text', nullable: true })
	checkOutNotes: string;

	@Column({ type: 'timestamptz', nullable: true })
	breakStartTime: Date;

	@Column({ type: 'timestamptz', nullable: true })
	breakEndTime: Date;

	@Column({ type: 'varchar', nullable: true })
	totalBreakTime: string;

	@Column({ type: 'int', nullable: true, default: 0 })
	breakCount: number;

	@Column({ type: 'simple-json', nullable: true })
	breakDetails: BreakDetail[];

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	breakLatitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	breakLongitude: number;

	@Column({ type: 'text', nullable: true })
	breakNotes: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
	distanceTravelledKm: number; // Distance travelled in kilometers for this shift

	@Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', nullable: false, onUpdate: 'CURRENT_TIMESTAMP', default: () => 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@Column({ type: 'timestamptz', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
	verifiedAt: Date;

	// Relations
	@ManyToOne(() => User, (user) => user?.attendance)
	@JoinColumn({ name: 'ownerClerkUserId', referencedColumnName: 'clerkUserId' })
	owner: User;

	@Column({ nullable: true })
	ownerClerkUserId: string;

	@ManyToOne(() => User, (user) => user?.attendance, { nullable: true })
	@JoinColumn({ name: 'verifiedByClerkUserId', referencedColumnName: 'clerkUserId' })
	verifiedBy: User;

	@Column({ nullable: true })
	verifiedByClerkUserId: string;

	@ManyToOne(() => Organisation, (organisation) => organisation?.attendances, { nullable: true })
	@JoinColumn({ name: 'organisationUid', referencedColumnName: 'clerkOrgId' })
	organisation: Organisation;

	@Column({ type: 'varchar', nullable: true })
	organisationUid: string;

	@ManyToOne(() => Branch, (branch) => branch?.attendances, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	// Relationship to the daily report generated for this attendance record
	@OneToOne(() => Report, { nullable: true })
	@JoinColumn()
	dailyReport: Report;
}
