import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';

export enum SummaryPeriod {
	HOURLY = 'hourly',
	DAILY = 'daily',
	WEEKLY = 'weekly',
	MONTHLY = 'monthly',
}

@Entity('usage_summaries')
@Unique(['organisationId', 'userId', 'period', 'periodStart', 'endpoint'])
export class UsageSummary {
	@PrimaryGeneratedColumn()
	id: number;

	// User and Organization relationships
	@Column({ name: 'user_id', nullable: true })
	userId?: number;

	@ManyToOne(() => User, { nullable: true })
	@JoinColumn({ name: 'user_id' })
	user?: User;

	@Column({ name: 'organisation_id', nullable: true })
	organisationId?: number;

	@ManyToOne(() => Organisation, { nullable: true })
	@JoinColumn({ name: 'organisation_id' })
	organisation?: Organisation;

	@Column({ name: 'branch_id', nullable: true })
	branchId?: number;

	@ManyToOne(() => Branch, { nullable: true })
	@JoinColumn({ name: 'branch_id' })
	branch?: Branch;

	// Time period
	@Column({
		type: 'enum',
		enum: SummaryPeriod,
	})
	period: SummaryPeriod;

	@Column({ name: 'period_start', type: 'timestamptz', nullable: true })
	periodStart?: Date;

	@Column({ name: 'period_end', type: 'timestamptz', nullable: true })
	periodEnd?: Date;

	// Endpoint or feature being tracked
	@Column({ length: 255, nullable: true })
	endpoint?: string;

	@Column({ length: 100, nullable: true })
	feature?: string;

	// Aggregated metrics
	@Column({ name: 'total_requests', default: 0 })
	totalRequests: number;

	@Column({ name: 'successful_requests', default: 0 })
	successfulRequests: number;

	@Column({ name: 'failed_requests', default: 0 })
	failedRequests: number;

	@Column({ name: 'avg_duration_ms', type: 'decimal', precision: 10, scale: 2, nullable: true })
	avgDurationMs?: number;

	@Column({ name: 'min_duration_ms', nullable: true })
	minDurationMs?: number;

	@Column({ name: 'max_duration_ms', nullable: true })
	maxDurationMs?: number;

	@Column({ name: 'total_data_transferred_bytes', type: 'bigint', default: 0 })
	totalDataTransferredBytes: number;

	@Column({ name: 'avg_request_size_bytes', type: 'decimal', precision: 10, scale: 2, nullable: true })
	avgRequestSizeBytes?: number;

	@Column({ name: 'avg_response_size_bytes', type: 'decimal', precision: 10, scale: 2, nullable: true })
	avgResponseSizeBytes?: number;

	// Error analysis
	@Column({ name: 'error_rate', type: 'decimal', precision: 5, scale: 4, default: 0 })
	errorRate: number; // Percentage of failed requests

	@Column({ type: 'jsonb', nullable: true })
	errorBreakdown?: Record<string, number>; // Error codes and their counts

	// Resource usage
	@Column({ name: 'avg_memory_usage_mb', type: 'decimal', precision: 10, scale: 2, nullable: true })
	avgMemoryUsageMb?: number;

	@Column({ name: 'avg_cpu_usage_percent', type: 'decimal', precision: 5, scale: 2, nullable: true })
	avgCpuUsagePercent?: number;

	// Device and client breakdown
	@Column({ type: 'jsonb', nullable: true })
	deviceBreakdown?: Record<string, number>; // device types and counts

	@Column({ type: 'jsonb', nullable: true })
	browserBreakdown?: Record<string, number>; // browsers and counts

	@Column({ type: 'jsonb', nullable: true })
	osBreakdown?: Record<string, number>; // operating systems and counts

	// Geographic breakdown
	@Column({ type: 'jsonb', nullable: true })
	geographicBreakdown?: Record<string, number>; // countries and counts

	// License usage
	@Column({ name: 'total_license_quota_consumed', type: 'bigint', default: 0 })
	totalLicenseQuotaConsumed: number;

	@Column({ type: 'jsonb', nullable: true })
	licenseFeatureBreakdown?: Record<string, number>; // features and quota consumed

	// Peak usage tracking
	@Column({ name: 'peak_requests_per_hour', default: 0 })
	peakRequestsPerHour: number;

	@Column({ name: 'peak_hour', type: 'timestamptz', nullable: true })
	peakHour?: Date;

	// Timestamps
	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;

	@Column({ name: 'last_aggregated_at', type: 'timestamptz', nullable: true })
	lastAggregatedAt?: Date;
}