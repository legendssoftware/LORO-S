import { Organisation } from '../../organisation/entities/organisation.entity';
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { Branch } from '../../branch/entities/branch.entity';
import { User } from '../../user/entities/user.entity';
import { ReportType } from '../constants/report-types.enum';

@Entity('reports')
export class Report {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column()
	name: string;

	@Column({ nullable: true })
	description: string;

	@Column({
		type: 'enum',
		enum: ReportType,
		default: ReportType.MAIN
	})
	reportType: ReportType;

	@Column({ type: 'json', nullable: true })
	filters: Record<string, any>;

	@CreateDateColumn({ type: 'timestamptz' })
	generatedAt: Date;

	@Column({ type: 'json' })
	reportData: Record<string, any>;

	@Column({ nullable: true })
	notes: string;

	// GPS tracking data
	@Column({ type: 'json', nullable: true })
	gpsData: {
		tripSummary?: {
			totalDistanceKm: number;
			totalTimeMinutes: number;
			averageSpeedKmh: number;
			movingTimeMinutes: number;
			stoppedTimeMinutes: number;
			numberOfStops: number;
			maxSpeedKmh: number;
		};
		stops?: Array<{
			latitude: number;
			longitude: number;
			address: string;
			startTime: string;
			endTime: string;
			durationMinutes: number;
			durationFormatted: string;
			pointsCount: number;
		}>;
		timeSpentByLocation?: Record<string, number>;
		averageTimePerLocationFormatted?: string;
		locationAnalysis?: {
			locationsVisited: number;
			averageTimePerLocation: number;
			averageTimePerLocationMinutes: number;
		};
		geocodingStatus?: {
			successful: number;
			failed: number;
			usedFallback: boolean;
		};
	};

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	totalDistanceKm: number;

	@Column({ type: 'int', nullable: true })
	totalStops: number;

	@ManyToOne(() => Organisation, (organisation) => organisation.reports)
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@ManyToOne(() => Branch, (branch) => branch.reports)
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@ManyToOne(() => User, (user) => user.reports)
	@JoinColumn({ name: 'ownerUid' })
	owner: User;

	@Column({ nullable: true })
	ownerUid: number;
}
