import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';

export enum UsageEventStatus {
	SUCCESS = 'success',
	FAILED = 'failed',
	TIMEOUT = 'timeout',
	UNAUTHORIZED = 'unauthorized',
	FORBIDDEN = 'forbidden',
	NOT_FOUND = 'not_found',
	SERVER_ERROR = 'server_error',
}

export enum UsageEventType {
	API_REQUEST = 'api_request',
	FILE_UPLOAD = 'file_upload',
	FILE_DOWNLOAD = 'file_download',
	REPORT_GENERATION = 'report_generation',
	EMAIL_SEND = 'email_send',
	NOTIFICATION_SEND = 'notification_send',
	DATABASE_QUERY = 'database_query',
	AUTHENTICATION = 'authentication',
	AUTHORIZATION = 'authorization',
}

@Entity('usage_events')
@Index(['organisationId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['endpoint', 'createdAt'])
@Index(['status', 'createdAt'])
export class UsageEvent {
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

	// Request details
	@Column({ length: 255 })
	endpoint: string;

	@Column({ length: 10 })
	method: string; // GET, POST, PUT, DELETE, etc.

	@Column({
		type: 'enum',
		enum: UsageEventType,
		default: UsageEventType.API_REQUEST,
	})
	eventType: UsageEventType;

	@Column({
		type: 'enum',
		enum: UsageEventStatus,
	})
	status: UsageEventStatus;

	@Column({ name: 'http_status_code' })
	httpStatusCode: number;

	// Timing information
	@Column({ name: 'duration_ms' })
	durationMs: number;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	// Request metadata
	@Column({ name: 'user_agent', type: 'text', nullable: true })
	userAgent?: string;

	@Column({ name: 'ip_address', length: 45, nullable: true })
	ipAddress?: string;

	@Column({ name: 'request_size_bytes', nullable: true })
	requestSizeBytes?: number;

	@Column({ name: 'response_size_bytes', nullable: true })
	responseSizeBytes?: number;

	// Device and client information
	@Column({ name: 'device_type', length: 50, nullable: true })
	deviceType?: string; // mobile, desktop, tablet

	@Column({ name: 'device_model', length: 100, nullable: true })
	deviceModel?: string;

	@Column({ name: 'browser_name', length: 50, nullable: true })
	browserName?: string;

	@Column({ name: 'browser_version', length: 20, nullable: true })
	browserVersion?: string;

	@Column({ name: 'os_name', length: 50, nullable: true })
	osName?: string;

	@Column({ name: 'os_version', length: 20, nullable: true })
	osVersion?: string;

	@Column({ name: 'client_version', length: 20, nullable: true })
	clientVersion?: string;

	// Geographic information
	@Column({ length: 10, nullable: true })
	country?: string;

	@Column({ length: 50, nullable: true })
	region?: string;

	@Column({ length: 100, nullable: true })
	city?: string;

	// Additional metadata
	@Column({ type: 'jsonb', nullable: true })
	metadata?: Record<string, any>;

	@Column({ type: 'jsonb', nullable: true })
	headers?: Record<string, string>;

	@Column({ type: 'text', nullable: true })
	errorMessage?: string;

	@Column({ type: 'text', nullable: true })
	errorStack?: string;

	// Resource usage
	@Column({ name: 'memory_usage_mb', type: 'decimal', precision: 10, scale: 2, nullable: true })
	memoryUsageMb?: number;

	@Column({ name: 'cpu_usage_percent', type: 'decimal', precision: 5, scale: 2, nullable: true })
	cpuUsagePercent?: number;

	// License tracking
	@Column({ name: 'license_feature', length: 100, nullable: true })
	licenseFeature?: string;

	@Column({ name: 'license_quota_consumed', nullable: true })
	licenseQuotaConsumed?: number;
}