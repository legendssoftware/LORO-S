#!/usr/bin/env node

/**
 * Database Migration Script - Two-Step Migration Process
 * 
 * Supports two migration steps:
 * 1. MySQL to Local PostgreSQL: Migrates data from remote MySQL to local PostgreSQL
 * 2. Local PostgreSQL to Remote PostgreSQL: Migrates data from local PostgreSQL to remote PostgreSQL
 * 
 * Step 2 skips tracking-related entities (tracking, geofence events) as requested.
 * 
 * Usage:
 *   # Step 1: MySQL to Local PostgreSQL
 *   npm run migrate:legacy-db -- --step mysql-to-local
 *   
 *   # Step 2: Local PostgreSQL to Remote PostgreSQL (uses REMOTE_PG_DB_HOST env vars)
 *   npm run migrate:legacy-db -- --step local-to-remote
 *   
 *   # Or override with custom URL
 *   npm run migrate:legacy-db -- --step local-to-remote --pg-url postgresql://user:pass@host:port/dbname
 *   
 *   # Dry run
 *   npm run migrate:legacy-db -- --step local-to-remote --dry-run
 *   
 *   # Import only specific entities
 *   npm run migrate:legacy-db -- --step local-to-remote --only orgs,branches,users,usertargets
 */

import * as mysql from 'mysql2/promise';
import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource, DeepPartial } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { UserProfile } from '../user/entities/user.profile.entity';
import { UserEmployeementProfile } from '../user/entities/user.employeement.profile.entity';
import { UserTarget } from '../user/entities/user-target.entity';
import { Device, DeviceRecords, DeviceLogs } from '../iot/entities/iot.entity';
import { License } from '../licensing/entities/license.entity';
import { LicenseUsage } from '../licensing/entities/license-usage.entity';
import { LicenseEvent } from '../licensing/entities/license-event.entity';
import { LicenseAudit } from '../licensing/entities/license-audit.entity';
import { Attendance } from '../attendance/entities/attendance.entity';
import { Claim } from '../claims/entities/claim.entity';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { Lead } from '../leads/entities/lead.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { QuotationItem } from '../shop/entities/quotation-item.entity';
import { Order } from '../shop/entities/order.entity';
import { OrderItem } from '../shop/entities/order-item.entity';
import { Task } from '../tasks/entities/task.entity';
import { SubTask } from '../tasks/entities/subtask.entity';
import { Route } from '../tasks/entities/route.entity';
import { TaskFlag } from '../tasks/entities/task-flag.entity';
import { TaskFlagItem } from '../tasks/entities/task-flag-item.entity';
import { Interaction } from '../interactions/entities/interaction.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { CommunicationLog } from '../communication/entities/communication-log.entity';
import { Journal } from '../journal/entities/journal.entity';
import { Report } from '../reports/entities/report.entity';
import { Leave } from '../leave/entities/leave.entity';
import { Warning } from '../warnings/entities/warning.entity';
import { Tracking } from '../tracking/entities/tracking.entity';
import { Geofence } from '../tracking/entities/geofence.entity';
import { GeofenceEvent } from '../tracking/entities/geofence-event.entity';
import { Doc } from '../docs/entities/doc.entity';
import { Asset } from '../assets/entities/asset.entity';
import { News } from '../news/entities/news.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { Competitor } from '../competitors/entities/competitor.entity';
import { Reseller } from '../resellers/entities/reseller.entity';
import { Product } from '../products/entities/product.entity';
import { ProductAnalytics } from '../products/entities/product-analytics.entity';
import { Client } from '../clients/entities/client.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { ClientCommunicationSchedule } from '../clients/entities/client-communication-schedule.entity';
import { Banners } from '../shop/entities/banners.entity';
import { Project } from '../shop/entities/project.entity';
import { Approval } from '../approvals/entities/approval.entity';
import { ApprovalHistory } from '../approvals/entities/approval-history.entity';
import { ApprovalSignature } from '../approvals/entities/approval-signature.entity';
import { UserRewards } from '../rewards/entities/user-rewards.entity';
import { Achievement } from '../rewards/entities/achievement.entity';
import { UnlockedItem } from '../rewards/entities/unlocked-item.entity';
import { XPTransaction } from '../rewards/entities/xp-transaction.entity';
import { Reward } from '../rewards/entities/reward.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { OrganisationAppearance } from '../organisation/entities/organisation-appearance.entity';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { Payslip } from '../payslips/entities/payslip.entity';
import { UsageEvent } from '../usage-tracking/entities/usage-event.entity';
import { UsageSummary } from '../usage-tracking/entities/usage-summary.entity';
import { GeneralStatus } from '../lib/enums/status.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { DeviceType, DeviceStatus } from '../lib/enums/iot';
import { LicenseType, SubscriptionPlan, LicenseStatus, BillingCycle } from '../lib/enums/license.enums';
import { AttendanceStatus } from '../lib/enums/attendance.enums';

interface ScriptArguments {
	'pg-url'?: string;
	'dry-run'?: boolean;
	only?: string;
	verbose?: boolean;
	step?: 'mysql-to-local' | 'local-to-remote';
}

interface UidMapping {
	[oldUid: number]: number;
}

interface IdMapping {
	[oldId: number]: number;
}

class MigrationStats {
	organisations = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	branches = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	users = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	userProfiles = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	userEmploymentProfiles = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	userTargets = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	devices = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	deviceRecords = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	deviceLogs = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	licenses = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	licenseUsage = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	licenseEvents = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	licenseAudit = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	attendance = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	claims = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	checkIns = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	leads = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	quotations = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	quotationItems = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	orders = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	orderItems = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	tasks = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	subtasks = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	routes = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	taskFlags = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	taskFlagItems = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	interactions = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	notifications = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	communicationLogs = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	journals = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	reports = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	leave = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	warnings = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	tracking = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	geofences = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	geofenceEvents = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	docs = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	assets = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	news = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	feedback = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	competitors = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	resellers = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	banners = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	projects = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	approvals = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	approvalHistory = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	approvalSignatures = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	userRewards = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	achievements = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	unlockedItems = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	xpTransactions = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	rewards = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	orgSettings = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	orgAppearance = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	orgHours = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	payslips = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	usageEvents = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
	usageSummary = { total: 0, imported: 0, skipped: 0, errors: 0, duplicates: 0, updated: 0 };
}

/**
 * Legacy Database Migrator
 * 
 * IMPORTANT DATA PRESERVATION RULES:
 * 1. All SELECT queries use SELECT * to import ALL columns from MySQL
 * 2. Use preserveField() and preserveFieldWithFallback() helpers to avoid losing data
 * 3. Never use || operator for defaults - it replaces falsy values (0, '', false)
 * 4. Use ?? operator or preserveField() to preserve 0, empty strings, and false values
 * 5. parseAndMapNumberArray preserves all valid numbers including 0
 * 6. JSON fields are parsed but original structure is preserved
 * 7. All foreign key arrays preserve mapped values, skip only unmapped ones
 */
class LegacyDbMigrator {
	private mysqlConnection: mysql.Connection | null = null;
	private pgDataSource: DataSource | null = null;
	private pgSourceDataSource: DataSource | null = null;
	private app: any = null;
	private configService: ConfigService | null = null;
	
	// Target Repositories (for writing)
	private orgRepo: Repository<Organisation> | null = null;
	private branchRepo: Repository<Branch> | null = null;
	private userRepo: Repository<User> | null = null;
	private userProfileRepo: Repository<UserProfile> | null = null;
	private userEmploymentRepo: Repository<UserEmployeementProfile> | null = null;
	private userTargetRepo: Repository<UserTarget> | null = null;
	private deviceRepo: Repository<Device> | null = null;
	private deviceRecordsRepo: Repository<DeviceRecords> | null = null;
	private deviceLogsRepo: Repository<DeviceLogs> | null = null;
	private licenseRepo: Repository<License> | null = null;
	private licenseUsageRepo: Repository<LicenseUsage> | null = null;
	private licenseEventRepo: Repository<LicenseEvent> | null = null;
	private licenseAuditRepo: Repository<LicenseAudit> | null = null;
	private attendanceRepo: Repository<Attendance> | null = null;
	private claimRepo: Repository<Claim> | null = null;
	private checkInRepo: Repository<CheckIn> | null = null;
	private leadRepo: Repository<Lead> | null = null;
	private quotationRepo: Repository<Quotation> | null = null;
	private quotationItemRepo: Repository<QuotationItem> | null = null;
	private orderRepo: Repository<Order> | null = null;
	private orderItemRepo: Repository<OrderItem> | null = null;
	private taskRepo: Repository<Task> | null = null;
	private subTaskRepo: Repository<SubTask> | null = null;
	private routeRepo: Repository<Route> | null = null;
	private taskFlagRepo: Repository<TaskFlag> | null = null;
	private taskFlagItemRepo: Repository<TaskFlagItem> | null = null;
	private interactionRepo: Repository<Interaction> | null = null;
	private notificationRepo: Repository<Notification> | null = null;
	private communicationLogRepo: Repository<CommunicationLog> | null = null;
	private journalRepo: Repository<Journal> | null = null;
	private reportRepo: Repository<Report> | null = null;
	private leaveRepo: Repository<Leave> | null = null;
	private warningRepo: Repository<Warning> | null = null;
	private trackingRepo: Repository<any> | null = null;
	private geofenceRepo: Repository<Geofence> | null = null;
	private geofenceEventRepo: Repository<GeofenceEvent> | null = null;
	private docRepo: Repository<Doc> | null = null;
	private assetRepo: Repository<Asset> | null = null;
	private newsRepo: Repository<News> | null = null;
	private feedbackRepo: Repository<Feedback> | null = null;
	private competitorRepo: Repository<Competitor> | null = null;
	private resellerRepo: Repository<Reseller> | null = null;
	private bannersRepo: Repository<Banners> | null = null;
	private projectRepo: Repository<Project> | null = null;
	private approvalRepo: Repository<Approval> | null = null;
	private approvalHistoryRepo: Repository<ApprovalHistory> | null = null;
	private approvalSignatureRepo: Repository<ApprovalSignature> | null = null;
	private userRewardsRepo: Repository<UserRewards> | null = null;
	private achievementRepo: Repository<Achievement> | null = null;
	private unlockedItemRepo: Repository<UnlockedItem> | null = null;
	private xpTransactionRepo: Repository<XPTransaction> | null = null;
	private rewardRepo: Repository<Reward> | null = null;
	private orgSettingsRepo: Repository<OrganisationSettings> | null = null;
	private orgAppearanceRepo: Repository<OrganisationAppearance> | null = null;
	private orgHoursRepo: Repository<OrganisationHours> | null = null;
	private payslipRepo: Repository<Payslip> | null = null;
	private usageEventRepo: Repository<UsageEvent> | null = null;
	private usageSummaryRepo: Repository<UsageSummary> | null = null;
	
	// Source Repositories (for reading from local PostgreSQL)
	private orgSourceRepo: Repository<Organisation> | null = null;
	private branchSourceRepo: Repository<Branch> | null = null;
	private userSourceRepo: Repository<User> | null = null;
	private userProfileSourceRepo: Repository<UserProfile> | null = null;
	private userEmploymentSourceRepo: Repository<UserEmployeementProfile> | null = null;
	private userTargetSourceRepo: Repository<UserTarget> | null = null;
	private deviceSourceRepo: Repository<Device> | null = null;
	private deviceRecordsSourceRepo: Repository<DeviceRecords> | null = null;
	private deviceLogsSourceRepo: Repository<DeviceLogs> | null = null;
	private licenseSourceRepo: Repository<License> | null = null;
	private licenseUsageSourceRepo: Repository<LicenseUsage> | null = null;
	private licenseEventSourceRepo: Repository<LicenseEvent> | null = null;
	private licenseAuditSourceRepo: Repository<LicenseAudit> | null = null;
	private attendanceSourceRepo: Repository<Attendance> | null = null;
	private claimSourceRepo: Repository<Claim> | null = null;
	private checkInSourceRepo: Repository<CheckIn> | null = null;
	private leadSourceRepo: Repository<Lead> | null = null;
	private quotationSourceRepo: Repository<Quotation> | null = null;
	private quotationItemSourceRepo: Repository<QuotationItem> | null = null;
	private orderSourceRepo: Repository<Order> | null = null;
	private orderItemSourceRepo: Repository<OrderItem> | null = null;
	private taskSourceRepo: Repository<Task> | null = null;
	private subTaskSourceRepo: Repository<SubTask> | null = null;
	private routeSourceRepo: Repository<Route> | null = null;
	private taskFlagSourceRepo: Repository<TaskFlag> | null = null;
	private taskFlagItemSourceRepo: Repository<TaskFlagItem> | null = null;
	private interactionSourceRepo: Repository<Interaction> | null = null;
	private notificationSourceRepo: Repository<Notification> | null = null;
	private communicationLogSourceRepo: Repository<CommunicationLog> | null = null;
	private journalSourceRepo: Repository<Journal> | null = null;
	private reportSourceRepo: Repository<Report> | null = null;
	private leaveSourceRepo: Repository<Leave> | null = null;
	private warningSourceRepo: Repository<Warning> | null = null;
	private geofenceSourceRepo: Repository<Geofence> | null = null;
	private geofenceEventSourceRepo: Repository<GeofenceEvent> | null = null;
	private docSourceRepo: Repository<Doc> | null = null;
	private assetSourceRepo: Repository<Asset> | null = null;
	private newsSourceRepo: Repository<News> | null = null;
	private feedbackSourceRepo: Repository<Feedback> | null = null;
	private competitorSourceRepo: Repository<Competitor> | null = null;
	private resellerSourceRepo: Repository<Reseller> | null = null;
	private bannersSourceRepo: Repository<Banners> | null = null;
	private projectSourceRepo: Repository<Project> | null = null;
	private approvalSourceRepo: Repository<Approval> | null = null;
	private approvalHistorySourceRepo: Repository<ApprovalHistory> | null = null;
	private approvalSignatureSourceRepo: Repository<ApprovalSignature> | null = null;
	private userRewardsSourceRepo: Repository<UserRewards> | null = null;
	private achievementSourceRepo: Repository<Achievement> | null = null;
	private unlockedItemSourceRepo: Repository<UnlockedItem> | null = null;
	private xpTransactionSourceRepo: Repository<XPTransaction> | null = null;
	private rewardSourceRepo: Repository<Reward> | null = null;
	private orgSettingsSourceRepo: Repository<OrganisationSettings> | null = null;
	private orgAppearanceSourceRepo: Repository<OrganisationAppearance> | null = null;
	private orgHoursSourceRepo: Repository<OrganisationHours> | null = null;
	private payslipSourceRepo: Repository<Payslip> | null = null;
	private usageEventSourceRepo: Repository<UsageEvent> | null = null;
	private usageSummarySourceRepo: Repository<UsageSummary> | null = null;
	
	// Mappings
	private orgMapping: UidMapping = {};
	private branchMapping: UidMapping = {};
	private userMapping: UidMapping = {};
	private deviceMapping: IdMapping = {};
	private licenseMapping: UidMapping = {};
	private leadMapping: UidMapping = {};
	private quotationMapping: UidMapping = {};
	private orderMapping: UidMapping = {};
	private taskMapping: UidMapping = {};
	private taskFlagMapping: UidMapping = {};
	private approvalMapping: UidMapping = {};
	private geofenceMapping: UidMapping = {};
	private projectMapping: UidMapping = {};
	private reportMapping: UidMapping = {};
	
	private stats = new MigrationStats();
	private dryRun = false;
	private onlyEntities: string[] = [];
	private verbose = false;
	private pendingManagedStaffUpdates: Map<number, any> = new Map();

	async initialize(step?: 'mysql-to-local' | 'local-to-remote', pgUrl?: string) {
		console.log('🔧 Initializing connections...\n');
		
		const migrationStep = step || 'mysql-to-local';
		
		if (migrationStep === 'mysql-to-local') {
			// Step 1: MySQL to Local PostgreSQL
			await this.initMySQL();
			await this.initPostgreSQL(migrationStep, pgUrl);
		} else if (migrationStep === 'local-to-remote') {
			// Step 2: Local PostgreSQL to Remote PostgreSQL
			await this.initPostgreSQLSource();
			await this.initPostgreSQL(migrationStep, pgUrl);
		}
		
		console.log('✅ All connections initialized\n');
	}

	private async initMySQL() {
		const host = process.env.DATABASE_HOST;
		const port = parseInt(process.env.DATABASE_PORT || '3306', 10);
		const user = process.env.DATABASE_USER;
		const password = process.env.DATABASE_PASSWORD;
		const database = process.env.DATABASE_NAME;

		if (!host || !user || !password || !database) {
			throw new Error('Missing MySQL connection details. Required: DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME');
		}

		console.log(`📊 Connecting to MySQL: ${host}:${port}/${database}`);
		this.mysqlConnection = await mysql.createConnection({
			host,
			port,
			user,
			password,
			database,
			multipleStatements: false,
			connectTimeout: 60000, // 60 seconds connection timeout
			// MySQL2 connection options - avoid invalid options that cause warnings
			enableKeepAlive: true,
			keepAliveInitialDelay: 0,
		});
		console.log('✅ MySQL connected\n');
	}

	private async reconnectMySQL() {
		// #region agent log
		fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:297',message:'Reconnecting MySQL',data:{hadConnection:!!this.mysqlConnection},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
		// #endregion
		
		try {
			if (this.mysqlConnection) {
				try {
					await this.mysqlConnection.end();
				} catch (e) {
					// Ignore errors when closing already closed connection
				}
			}
		} catch (e) {
			// Ignore errors
		}
		
		await this.initMySQL();
		
		// #region agent log
		fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:310',message:'MySQL reconnected',data:{hasConnection:!!this.mysqlConnection},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
		// #endregion
	}

	private async initPostgreSQL(step?: 'mysql-to-local' | 'local-to-remote', pgUrl?: string) {
		// Bootstrap NestJS app to get repositories
		console.log('📊 Initializing NestJS app for PostgreSQL...');
		this.app = await NestFactory.createApplicationContext(AppModule, {
			logger: false,
		});
		
		this.configService = this.app.get(ConfigService);
		this.pgDataSource = this.app.get(DataSource);

		// Override PostgreSQL connection if URL provided or if local-to-remote step with REMOTE_PG_DB_HOST env vars
		if (pgUrl) {
			console.log(`📊 Overriding PostgreSQL connection with provided URL`);
			const url = new URL(pgUrl);
			const host = url.hostname;
			const port = parseInt(url.port || '5432', 10);
			const username = url.username;
			const password = url.password;
			const database = url.pathname.slice(1); // Remove leading /

			// Check for SSL mode in URL parameters
			const sslMode = url.searchParams.get('sslmode');
			
			// Detect if connecting to localhost or private network
			const isLocalhost = host === 'localhost' 
				|| host === '127.0.0.1' 
				|| host?.startsWith('192.168.') 
				|| host?.startsWith('10.');
			const isRender = host?.includes('dpg-') || host?.includes('render.com');
			
			// Determine SSL configuration
			// If sslmode is explicitly set in URL, respect it; otherwise enable for remote connections
			let enableSSL = false;
			if (sslMode === 'require' || sslMode === 'prefer' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
				enableSSL = true;
			} else if (sslMode === 'disable') {
				enableSSL = false;
			} else {
				// Default: enable SSL for remote connections
				enableSSL = !isLocalhost || isRender;
			}

			console.log(`🔐 SSL Configuration: ${enableSSL ? 'ENABLED' : 'DISABLED'} (host: ${host}, sslmode: ${sslMode || 'not specified'})`);

			// Store reference to original DataSource for cleanup
			const originalDataSource = this.pgDataSource;

			// Create new DataSource with override
			// Ensure LicenseAudit is included in entities
			const sourceEntities = this.pgDataSource.options.entities;
			let entities: any = sourceEntities;
			// If entities is an array, ensure LicenseAudit is included
			if (Array.isArray(sourceEntities)) {
				entities = [...sourceEntities];
				if (!entities.includes(LicenseAudit)) {
					entities.push(LicenseAudit);
				}
			}
			const newDataSource = new DataSource({
				type: 'postgres',
				host,
				port,
				username,
				password,
				database,
				entities: entities,
				synchronize: false,
				logging: false,
				extra: {
					ssl: enableSSL ? { rejectUnauthorized: false } : false,
				},
			});

			await newDataSource.initialize();
			
			// Don't destroy original - NestJS will handle it
			// Just replace our reference
			this.pgDataSource = newDataSource;
		} else if (step === 'local-to-remote') {
			// Use REMOTE_PG_DB_HOST env vars for local-to-remote migration
			console.log('📊 Using REMOTE_PG_DB_HOST environment variables for remote PostgreSQL connection');
			
			const host = process.env.REMOTE_PG_DB_HOST || '';
			const port = parseInt(process.env.REMOTE_PG_DB_PORT || '5432', 10);
			const username = process.env.REMOTE_PG_DB_USERNAME || '';
			const password = process.env.REMOTE_PG_DB_PASSWORD || '';
			const database = process.env.REMOTE_PG_DB_NAME || '';

			// Parse connection string if REMOTE_PG_DB_HOST contains a full PostgreSQL URL
			let finalHost = host;
			let finalPort = port;
			let finalUsername = username;
			let finalPassword = password;
			let finalDatabase = database;

			if (host && (host.startsWith('postgresql://') || host.startsWith('postgres://'))) {
				try {
					const url = new URL(host);
					finalHost = url.hostname;
					finalPort = url.port ? parseInt(url.port, 10) : 5432;
					finalUsername = url.username || username;
					finalPassword = url.password || password;
					finalDatabase = url.pathname ? url.pathname.slice(1) : database;
				} catch (error) {
					console.error('Failed to parse REMOTE_PG_DB_HOST connection string:', error);
					throw error;
				}
			}

			if (!finalHost || !finalUsername || !finalPassword || !finalDatabase) {
				throw new Error('Missing required REMOTE_PG_DB_HOST environment variables. Please set REMOTE_PG_DB_HOST, REMOTE_PG_DB_USERNAME, REMOTE_PG_DB_PASSWORD, and REMOTE_PG_DB_NAME');
			}

			// Detect if connecting to localhost or private network (disable SSL)
			// Match the logic from app.module.ts for consistency
			const isLocalhost = finalHost === 'localhost' 
				|| finalHost === '127.0.0.1' 
				|| finalHost?.startsWith('192.168.') 
				|| finalHost?.startsWith('10.');
			
			// Detect if connecting to Render PostgreSQL (common remote host)
			const isRender = finalHost?.includes('dpg-') || finalHost?.includes('render.com');
			
			// For local-to-remote migration, we're connecting to a remote database
			// Enable SSL for all remote connections (most remote databases require SSL/TLS)
			// Only disable SSL if explicitly connecting to localhost/private network
			const enableSSL = !isLocalhost;

			console.log(`🔐 SSL Configuration: ${enableSSL ? 'ENABLED' : 'DISABLED'} (host: ${finalHost}, isLocalhost: ${isLocalhost}, isRender: ${isRender})`);

			// Create new DataSource with remote connection
			// Ensure LicenseAudit is included in entities
			const sourceEntities = this.pgDataSource.options.entities;
			let entities: any = sourceEntities;
			// If entities is an array, ensure LicenseAudit is included
			if (Array.isArray(sourceEntities)) {
				entities = [...sourceEntities];
				if (!entities.includes(LicenseAudit)) {
					entities.push(LicenseAudit);
				}
			}
			const newDataSource = new DataSource({
				type: 'postgres',
				host: finalHost,
				port: finalPort,
				username: finalUsername,
				password: finalPassword,
				database: finalDatabase,
				entities: entities,
				synchronize: false,
				logging: false,
				extra: {
					ssl: enableSSL ? { rejectUnauthorized: false } : false,
				},
			});

			await newDataSource.initialize();
			this.pgDataSource = newDataSource;
			console.log(`✅ Connected to remote PostgreSQL: ${finalHost}:${finalPort}/${finalDatabase}\n`);
		}

		// Get repositories
		this.orgRepo = this.pgDataSource.getRepository(Organisation);
		this.branchRepo = this.pgDataSource.getRepository(Branch);
		this.userRepo = this.pgDataSource.getRepository(User);
		this.userProfileRepo = this.pgDataSource.getRepository(UserProfile);
		this.userEmploymentRepo = this.pgDataSource.getRepository(UserEmployeementProfile);
		this.userTargetRepo = this.pgDataSource.getRepository(UserTarget);
		this.deviceRepo = this.pgDataSource.getRepository(Device);
		this.deviceRecordsRepo = this.pgDataSource.getRepository(DeviceRecords);
		this.deviceLogsRepo = this.pgDataSource.getRepository(DeviceLogs);
		this.licenseRepo = this.pgDataSource.getRepository(License);
		this.licenseUsageRepo = this.pgDataSource.getRepository(LicenseUsage);
		this.licenseEventRepo = this.pgDataSource.getRepository(LicenseEvent);
		try {
			this.licenseAuditRepo = this.pgDataSource.getRepository(LicenseAudit);
		} catch (error: any) {
			if (error.name === 'EntityMetadataNotFoundError') {
				console.warn('⚠️  LicenseAudit entity not registered in DataSource, skipping repository initialization');
				this.licenseAuditRepo = null;
			} else {
				throw error;
			}
		}
		this.attendanceRepo = this.pgDataSource.getRepository(Attendance);
		this.claimRepo = this.pgDataSource.getRepository(Claim);
		this.checkInRepo = this.pgDataSource.getRepository(CheckIn);
		this.leadRepo = this.pgDataSource.getRepository(Lead);
		this.quotationRepo = this.pgDataSource.getRepository(Quotation);
		this.quotationItemRepo = this.pgDataSource.getRepository(QuotationItem);
		this.orderRepo = this.pgDataSource.getRepository(Order);
		this.orderItemRepo = this.pgDataSource.getRepository(OrderItem);
		this.taskRepo = this.pgDataSource.getRepository(Task);
		this.subTaskRepo = this.pgDataSource.getRepository(SubTask);
		this.routeRepo = this.pgDataSource.getRepository(Route);
		this.taskFlagRepo = this.pgDataSource.getRepository(TaskFlag);
		this.taskFlagItemRepo = this.pgDataSource.getRepository(TaskFlagItem);
		this.interactionRepo = this.pgDataSource.getRepository(Interaction);
		this.notificationRepo = this.pgDataSource.getRepository(Notification);
		this.communicationLogRepo = this.pgDataSource.getRepository(CommunicationLog);
		this.journalRepo = this.pgDataSource.getRepository(Journal);
		this.reportRepo = this.pgDataSource.getRepository(Report);
		this.leaveRepo = this.pgDataSource.getRepository(Leave);
		this.warningRepo = this.pgDataSource.getRepository(Warning);
		// this.trackingRepo = this.pgDataSource.getRepository(Tracking); // Tracking import skipped
		this.geofenceRepo = this.pgDataSource.getRepository(Geofence);
		this.geofenceEventRepo = this.pgDataSource.getRepository(GeofenceEvent);
		this.docRepo = this.pgDataSource.getRepository(Doc);
		this.assetRepo = this.pgDataSource.getRepository(Asset);
		this.newsRepo = this.pgDataSource.getRepository(News);
		this.feedbackRepo = this.pgDataSource.getRepository(Feedback);
		this.competitorRepo = this.pgDataSource.getRepository(Competitor);
		this.resellerRepo = this.pgDataSource.getRepository(Reseller);
		this.bannersRepo = this.pgDataSource.getRepository(Banners);
		this.projectRepo = this.pgDataSource.getRepository(Project);
		this.approvalRepo = this.pgDataSource.getRepository(Approval);
		this.approvalHistoryRepo = this.pgDataSource.getRepository(ApprovalHistory);
		this.approvalSignatureRepo = this.pgDataSource.getRepository(ApprovalSignature);
		this.userRewardsRepo = this.pgDataSource.getRepository(UserRewards);
		this.achievementRepo = this.pgDataSource.getRepository(Achievement);
		this.unlockedItemRepo = this.pgDataSource.getRepository(UnlockedItem);
		this.xpTransactionRepo = this.pgDataSource.getRepository(XPTransaction);
		this.rewardRepo = this.pgDataSource.getRepository(Reward);
		this.orgSettingsRepo = this.pgDataSource.getRepository(OrganisationSettings);
		this.orgAppearanceRepo = this.pgDataSource.getRepository(OrganisationAppearance);
		this.orgHoursRepo = this.pgDataSource.getRepository(OrganisationHours);
		this.payslipRepo = this.pgDataSource.getRepository(Payslip);
		this.usageEventRepo = this.pgDataSource.getRepository(UsageEvent);
		this.usageSummaryRepo = this.pgDataSource.getRepository(UsageSummary);

		console.log('✅ PostgreSQL connected via NestJS\n');
	}

	private async initPostgreSQLSource() {
		// Initialize local PostgreSQL connection (source)
		console.log('📊 Connecting to local PostgreSQL (source)...');
		
		const host = process.env.PG_DB_HOST || 'localhost';
		const port = parseInt(process.env.PG_DB_PORT || '5432', 10);
		const username = process.env.PG_DB_USERNAME || 'brandonnkawu';
		const password = process.env.PG_DB_PASSWORD || 'Umzingeli@2026';
		const database = process.env.PG_DB_NAME || 'sana';

		// Parse connection string if PG_DB_HOST contains a full PostgreSQL URL
		let finalHost = host;
		let finalPort = port;
		let finalUsername = username;
		let finalPassword = password;
		let finalDatabase = database;

		if (host && (host.startsWith('postgresql://') || host.startsWith('postgres://'))) {
			try {
				const url = new URL(host);
				finalHost = url.hostname;
				finalPort = url.port ? parseInt(url.port, 10) : 5432;
				finalUsername = url.username || username;
				finalPassword = url.password || password;
				finalDatabase = url.pathname ? url.pathname.slice(1) : database;
			} catch (error) {
				console.error('Failed to parse PostgreSQL connection string:', error);
			}
		}

		const isLocalhost = finalHost === 'localhost' || finalHost === '127.0.0.1';
		const enableSSL = false; // Disable SSL for localhost

		this.pgSourceDataSource = new DataSource({
			type: 'postgres',
			host: finalHost,
			port: finalPort,
			username: finalUsername,
			password: finalPassword,
			database: finalDatabase,
			entities: [
				Organisation, Branch, User, UserProfile, UserEmployeementProfile, UserTarget,
				Device, DeviceRecords, DeviceLogs, License, LicenseUsage, LicenseEvent, LicenseAudit,
				Attendance, Claim, CheckIn, Lead, Quotation, QuotationItem, Order, OrderItem,
				Task, SubTask, Route, TaskFlag, TaskFlagItem, Interaction, Notification,
				CommunicationLog, Journal, Report, Leave, Warning, Tracking, Geofence, GeofenceEvent,
				Doc, Asset, News, Feedback, Competitor, Reseller, Product, ProductAnalytics,
				Client, ClientAuth, ClientCommunicationSchedule, Banners, Project,
				Approval, ApprovalHistory, ApprovalSignature, UserRewards, Achievement,
				UnlockedItem, XPTransaction, Reward, OrganisationSettings, OrganisationAppearance,
				OrganisationHours, Payslip, UsageEvent, UsageSummary,
			],
			synchronize: false,
			logging: false,
			extra: {
				ssl: enableSSL ? { rejectUnauthorized: false } : false,
			},
		});

		await this.pgSourceDataSource.initialize();
		console.log(`✅ Connected to local PostgreSQL: ${finalHost}:${finalPort}/${finalDatabase}\n`);

		// Initialize source repositories
		this.orgSourceRepo = this.pgSourceDataSource.getRepository(Organisation);
		this.branchSourceRepo = this.pgSourceDataSource.getRepository(Branch);
		this.userSourceRepo = this.pgSourceDataSource.getRepository(User);
		this.userProfileSourceRepo = this.pgSourceDataSource.getRepository(UserProfile);
		this.userEmploymentSourceRepo = this.pgSourceDataSource.getRepository(UserEmployeementProfile);
		this.userTargetSourceRepo = this.pgSourceDataSource.getRepository(UserTarget);
		this.deviceSourceRepo = this.pgSourceDataSource.getRepository(Device);
		this.deviceRecordsSourceRepo = this.pgSourceDataSource.getRepository(DeviceRecords);
		this.deviceLogsSourceRepo = this.pgSourceDataSource.getRepository(DeviceLogs);
		this.licenseSourceRepo = this.pgSourceDataSource.getRepository(License);
		this.licenseUsageSourceRepo = this.pgSourceDataSource.getRepository(LicenseUsage);
		this.licenseEventSourceRepo = this.pgSourceDataSource.getRepository(LicenseEvent);
		try {
			this.licenseAuditSourceRepo = this.pgSourceDataSource.getRepository(LicenseAudit);
		} catch (error: any) {
			if (error.name === 'EntityMetadataNotFoundError') {
				console.warn('⚠️  LicenseAudit entity not registered in source DataSource, skipping repository initialization');
				this.licenseAuditSourceRepo = null;
			} else {
				throw error;
			}
		}
		this.attendanceSourceRepo = this.pgSourceDataSource.getRepository(Attendance);
		this.claimSourceRepo = this.pgSourceDataSource.getRepository(Claim);
		this.checkInSourceRepo = this.pgSourceDataSource.getRepository(CheckIn);
		this.leadSourceRepo = this.pgSourceDataSource.getRepository(Lead);
		this.quotationSourceRepo = this.pgSourceDataSource.getRepository(Quotation);
		this.quotationItemSourceRepo = this.pgSourceDataSource.getRepository(QuotationItem);
		this.orderSourceRepo = this.pgSourceDataSource.getRepository(Order);
		this.orderItemSourceRepo = this.pgSourceDataSource.getRepository(OrderItem);
		this.taskSourceRepo = this.pgSourceDataSource.getRepository(Task);
		this.subTaskSourceRepo = this.pgSourceDataSource.getRepository(SubTask);
		this.routeSourceRepo = this.pgSourceDataSource.getRepository(Route);
		this.taskFlagSourceRepo = this.pgSourceDataSource.getRepository(TaskFlag);
		this.taskFlagItemSourceRepo = this.pgSourceDataSource.getRepository(TaskFlagItem);
		this.interactionSourceRepo = this.pgSourceDataSource.getRepository(Interaction);
		this.notificationSourceRepo = this.pgSourceDataSource.getRepository(Notification);
		this.communicationLogSourceRepo = this.pgSourceDataSource.getRepository(CommunicationLog);
		this.journalSourceRepo = this.pgSourceDataSource.getRepository(Journal);
		this.reportSourceRepo = this.pgSourceDataSource.getRepository(Report);
		this.leaveSourceRepo = this.pgSourceDataSource.getRepository(Leave);
		this.warningSourceRepo = this.pgSourceDataSource.getRepository(Warning);
		this.geofenceSourceRepo = this.pgSourceDataSource.getRepository(Geofence);
		this.geofenceEventSourceRepo = this.pgSourceDataSource.getRepository(GeofenceEvent);
		this.docSourceRepo = this.pgSourceDataSource.getRepository(Doc);
		this.assetSourceRepo = this.pgSourceDataSource.getRepository(Asset);
		this.newsSourceRepo = this.pgSourceDataSource.getRepository(News);
		this.feedbackSourceRepo = this.pgSourceDataSource.getRepository(Feedback);
		this.competitorSourceRepo = this.pgSourceDataSource.getRepository(Competitor);
		this.resellerSourceRepo = this.pgSourceDataSource.getRepository(Reseller);
		this.bannersSourceRepo = this.pgSourceDataSource.getRepository(Banners);
		this.projectSourceRepo = this.pgSourceDataSource.getRepository(Project);
		this.approvalSourceRepo = this.pgSourceDataSource.getRepository(Approval);
		this.approvalHistorySourceRepo = this.pgSourceDataSource.getRepository(ApprovalHistory);
		this.approvalSignatureSourceRepo = this.pgSourceDataSource.getRepository(ApprovalSignature);
		this.userRewardsSourceRepo = this.pgSourceDataSource.getRepository(UserRewards);
		this.achievementSourceRepo = this.pgSourceDataSource.getRepository(Achievement);
		this.unlockedItemSourceRepo = this.pgSourceDataSource.getRepository(UnlockedItem);
		this.xpTransactionSourceRepo = this.pgSourceDataSource.getRepository(XPTransaction);
		this.rewardSourceRepo = this.pgSourceDataSource.getRepository(Reward);
		this.orgSettingsSourceRepo = this.pgSourceDataSource.getRepository(OrganisationSettings);
		this.orgAppearanceSourceRepo = this.pgSourceDataSource.getRepository(OrganisationAppearance);
		this.orgHoursSourceRepo = this.pgSourceDataSource.getRepository(OrganisationHours);
		this.payslipSourceRepo = this.pgSourceDataSource.getRepository(Payslip);
		this.usageEventSourceRepo = this.pgSourceDataSource.getRepository(UsageEvent);
		this.usageSummarySourceRepo = this.pgSourceDataSource.getRepository(UsageSummary);
	}

	async migrate(options: ScriptArguments) {
		this.dryRun = options['dry-run'] || false;
		this.verbose = options.verbose || false;
		this.onlyEntities = options.only ? options.only.split(',').map(e => e.trim()) : [];

		const step = options.step || 'mysql-to-local';

		if (step === 'local-to-remote') {
			await this.migrateFromPostgreSQL(options);
			return;
		}

		if (this.dryRun) {
			console.log('🔍 DRY RUN MODE - No data will be written\n');
		}

		const startTime = Date.now();

		try {
			// Import in dependency order
			// Note: Clear tables before importing to avoid duplicates
			if (this.shouldImport('orgs')) {
				await this.clearTable(this.orgRepo, 'Organisations', Organisation);
				await this.importOrganisations();
			}

			if (this.shouldImport('branches')) {
				await this.clearTable(this.branchRepo, 'Branches', Branch);
				await this.importBranches();
			}

			if (this.shouldImport('users')) {
				await this.clearTable(this.userTargetRepo, 'User Targets', UserTarget);
				await this.clearTable(this.userEmploymentRepo, 'User Employment Profiles', UserEmployeementProfile);
				await this.clearTable(this.userProfileRepo, 'User Profiles', UserProfile);
				await this.clearTable(this.userRepo, 'Users', User);
				await this.importUsers();
				await this.importUserProfiles();
				await this.importUserEmploymentProfiles();
				await this.importUserTargets();
			}

			if (this.shouldImport('devices')) {
				// Clear device records and logs before importing devices
				await this.clearDeviceRecordsAndLogs();
				await this.clearTable(this.deviceRepo, 'Devices', Device);
				await this.importDevices();
				// Device records import - SKIPPED per user request
				// if (this.shouldImport('devicerecords')) {
				// 	await this.clearTable(this.deviceRecordsRepo, 'Device Records', DeviceRecords);
				// 	await this.importDeviceRecords();
				// }
			}

			if (this.shouldImport('licenses')) {
				await this.clearTable(this.licenseAuditRepo, 'License Audit', LicenseAudit);
				await this.clearTable(this.licenseEventRepo, 'License Events', LicenseEvent);
				await this.clearTable(this.licenseUsageRepo, 'License Usage', LicenseUsage);
				await this.clearTable(this.licenseRepo, 'Licenses', License);
				await this.importLicenses();
			}

			// Organisation settings (after orgs)
			if (this.shouldImport('orgs')) {
				await this.clearTable(this.orgHoursRepo, 'Organisation Hours', OrganisationHours);
				await this.clearTable(this.orgAppearanceRepo, 'Organisation Appearance', OrganisationAppearance);
				await this.clearTable(this.orgSettingsRepo, 'Organisation Settings', OrganisationSettings);
				await this.importOrganisationSettings();
				await this.importOrganisationAppearance();
				await this.importOrganisationHours();
			}

			// Reports import - SKIPPED per user request
			// if (this.shouldImport('reports')) {
			// 	await this.clearTable(this.reportRepo, 'Reports', Report);
			// 	await this.importReports();
			// }

			// Core transactional data
			// Attendance import - December only
			if (this.shouldImport('attendance')) {
				// Clear attendance records before importing to avoid duplicates
				await this.clearAttendanceRecords();
				await this.importAttendance();
			}
			// Claims import - SKIPPED per user request
			// if (this.shouldImport('claims')) {
			// 	await this.clearTable(this.claimRepo, 'Claims', Claim);
			// 	await this.importClaims();
			// }
			if (this.shouldImport('checkins')) {
				await this.clearTable(this.checkInRepo, 'Check-ins', CheckIn);
				await this.importCheckIns();
			}

			// Sales & business
			// Leads import - SKIPPED per user request
			// if (this.shouldImport('leads')) {
			// 	await this.clearTable(this.leadRepo, 'Leads', Lead);
			// 	await this.importLeads();
			// }
			// Quotations import - SKIPPED per user request
			// if (this.shouldImport('quotations')) {
			// 	await this.clearTable(this.quotationItemRepo, 'Quotation Items', QuotationItem);
			// 	await this.clearTable(this.quotationRepo, 'Quotations', Quotation);
			// 	await this.importQuotations();
			// 	await this.importQuotationItems();
			// }
			if (this.shouldImport('orders')) {
				await this.clearTable(this.orderItemRepo, 'Order Items', OrderItem);
				await this.clearTable(this.orderRepo, 'Orders', Order);
				await this.importOrders();
				await this.importOrderItems();
			}

			// Tasks & activities - SKIPPED per user request
			// if (this.shouldImport('tasks')) {
			// 	await this.clearTable(this.subTaskRepo, 'Subtasks', SubTask);
			// 	await this.clearTable(this.taskRepo, 'Tasks', Task);
			// 	await this.importTasks();
			// 	await this.importSubtasks();
			// }

			// Communication & interactions - SKIPPED per user request
			// if (this.shouldImport('interactions')) {
			// 	await this.clearTable(this.interactionRepo, 'Interactions', Interaction);
			// 	await this.importInteractions();
			// }
			// Notifications import - SKIPPED per user request
			// if (this.shouldImport('notifications')) {
			// 	await this.clearTable(this.notificationRepo, 'Notifications', Notification);
			// 	await this.importNotifications();
			// }
			if (this.shouldImport('journals')) {
				await this.clearTable(this.journalRepo, 'Journals', Journal);
				await this.importJournals();
			}

			// HR & management
			// Leave import - SKIPPED per user request
			// if (this.shouldImport('leave')) {
			// 	await this.clearTable(this.leaveRepo, 'Leave', Leave);
			// 	await this.importLeave();
			// }
			// Warnings import - SKIPPED per user request
			// if (this.shouldImport('warnings')) {
			// 	await this.clearTable(this.warningRepo, 'Warnings', Warning);
			// 	await this.importWarnings();
			// }

			// Documents & files - SKIPPED per user request
			// if (this.shouldImport('docs')) {
			// 	await this.clearTable(this.docRepo, 'Docs', Doc);
			// 	await this.importDocs();
			// }

			// Other modules
			if (this.shouldImport('assets')) {
				await this.clearTable(this.assetRepo, 'Assets', Asset);
				await this.importAssets();
			}
			// News import - SKIPPED per user request
			// if (this.shouldImport('news')) {
			// 	await this.clearTable(this.newsRepo, 'News', News);
			// 	await this.importNews();
			// }
			if (this.shouldImport('feedback')) {
				await this.clearTable(this.feedbackRepo, 'Feedback', Feedback);
				await this.importFeedback();
			}
			// Competitors import - SKIPPED per user request
			// if (this.shouldImport('competitors')) {
			// 	await this.clearTable(this.competitorRepo, 'Competitors', Competitor);
			// 	await this.importCompetitors();
			// }
			if (this.shouldImport('resellers')) {
				await this.clearTable(this.resellerRepo, 'Resellers', Reseller);
				await this.importResellers();
			}
			if (this.shouldImport('banners')) {
				await this.clearTable(this.bannersRepo, 'Banners', Banners);
				await this.importBanners();
			}
			if (this.shouldImport('projects')) {
				await this.clearTable(this.projectRepo, 'Projects', Project);
				await this.importProjects();
			}

			// User rewards (after users are imported)
			// Note: UserRewards is imported, but Reward entity import is skipped
			if (this.shouldImport('users')) {
				await this.clearTable(this.userRewardsRepo, 'User Rewards', UserRewards);
				await this.importUserRewards();
			}

			// Post-process user relationships after all entities are imported
			if (this.shouldImport('users')) {
				await this.postProcessUserRelationships();
			}

			// Large tables moved to end for performance
			// Tracking import - SKIPPED (GPS records import disabled)
			// if (this.shouldImport('tracking')) {
			// 	await this.clearTable(this.geofenceEventRepo, 'Geofence Events', GeofenceEvent);
			// 	await this.clearTable(this.geofenceRepo, 'Geofences', Geofence);
			// 	await this.clearTable(this.trackingRepo, 'Tracking', Tracking);
			// 	await this.importTracking();
			// }

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			this.printStats(duration);

		} catch (error) {
			console.error('\n❌ Migration failed:', error);
			throw error;
		}
	}

	private async migrateFromPostgreSQL(options: ScriptArguments) {
		this.dryRun = options['dry-run'] || false;
		this.verbose = options.verbose || false;
		this.onlyEntities = options.only ? options.only.split(',').map(e => e.trim()) : [];

		if (this.dryRun) {
			console.log('🔍 DRY RUN MODE - No data will be written\n');
		}

		if (!this.pgSourceDataSource || !this.pgDataSource) {
			throw new Error('Both source and target PostgreSQL connections must be initialized');
		}

		console.log('🚀 Starting PostgreSQL-to-PostgreSQL migration (local to remote)...\n');
		console.log('⚠️  Skipping tracking-related entities\n');

		const startTime = Date.now();

		try {
			// Import in dependency order - copy data as-is from source to target
			// Skip tracking-related entities (tracking, geofence events)

			if (this.shouldImport('orgs')) {
				await this.clearTable(this.orgRepo, 'Organisations', Organisation);
				await this.copyEntities(this.orgSourceRepo!, this.orgRepo!, 'Organisations');
			}

			if (this.shouldImport('branches')) {
				await this.clearTable(this.branchRepo, 'Branches', Branch);
				await this.copyEntities(this.branchSourceRepo!, this.branchRepo!, 'Branches');
			}

			if (this.shouldImport('users')) {
				await this.clearTable(this.userTargetRepo, 'User Targets', UserTarget);
				await this.clearTable(this.userEmploymentRepo, 'User Employment Profiles', UserEmployeementProfile);
				await this.clearTable(this.userProfileRepo, 'User Profiles', UserProfile);
				await this.clearTable(this.userRepo, 'Users', User);
				await this.copyEntities(this.userSourceRepo!, this.userRepo!, 'Users');
				await this.copyEntities(this.userProfileSourceRepo!, this.userProfileRepo!, 'User Profiles');
				await this.copyEntities(this.userEmploymentSourceRepo!, this.userEmploymentRepo!, 'User Employment Profiles');
				await this.copyEntities(this.userTargetSourceRepo!, this.userTargetRepo!, 'User Targets');
			}

			if (this.shouldImport('devices')) {
				await this.clearDeviceRecordsAndLogs();
				await this.clearTable(this.deviceRepo, 'Devices', Device);
				await this.copyEntities(this.deviceSourceRepo!, this.deviceRepo!, 'Devices');
				// Device records import - SKIPPED per user request
				// if (this.shouldImport('devicerecords')) {
				// 	await this.clearTable(this.deviceRecordsRepo, 'Device Records', DeviceRecords);
				// 	await this.copyEntities(this.deviceRecordsSourceRepo!, this.deviceRecordsRepo!, 'Device Records');
				// }
			}

			if (this.shouldImport('licenses')) {
				if (this.licenseAuditRepo && this.licenseAuditSourceRepo) {
					try {
						await this.clearTable(this.licenseAuditRepo, 'License Audit', LicenseAudit);
						await this.copyEntities(this.licenseAuditSourceRepo, this.licenseAuditRepo, 'License Audit');
					} catch (error: any) {
						if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('relation')) {
							console.log(`  ⚠️  License Audit table does not exist in target database, skipping...`);
						} else {
							throw error;
						}
					}
				}
				await this.clearTable(this.licenseEventRepo, 'License Events', LicenseEvent);
				await this.clearTable(this.licenseUsageRepo, 'License Usage', LicenseUsage);
				await this.clearTable(this.licenseRepo, 'Licenses', License);
				await this.copyEntities(this.licenseSourceRepo!, this.licenseRepo!, 'Licenses');
				await this.copyEntities(this.licenseUsageSourceRepo!, this.licenseUsageRepo!, 'License Usage');
				await this.copyEntities(this.licenseEventSourceRepo!, this.licenseEventRepo!, 'License Events');
			}

			if (this.shouldImport('orgs')) {
				await this.clearTable(this.orgHoursRepo, 'Organisation Hours', OrganisationHours);
				await this.clearTable(this.orgAppearanceRepo, 'Organisation Appearance', OrganisationAppearance);
				await this.clearTable(this.orgSettingsRepo, 'Organisation Settings', OrganisationSettings);
				await this.copyEntities(this.orgSettingsSourceRepo!, this.orgSettingsRepo!, 'Organisation Settings');
				await this.copyEntities(this.orgAppearanceSourceRepo!, this.orgAppearanceRepo!, 'Organisation Appearance');
				await this.copyEntities(this.orgHoursSourceRepo!, this.orgHoursRepo!, 'Organisation Hours');
			}

			// Reports import - SKIPPED per user request
			// if (this.shouldImport('reports')) {
			// 	await this.clearTable(this.reportRepo, 'Reports', Report);
			// 	await this.copyEntities(this.reportSourceRepo!, this.reportRepo!, 'Reports');
			// }

			if (this.shouldImport('attendance')) {
				await this.clearAttendanceRecords();
				await this.copyEntities(this.attendanceSourceRepo!, this.attendanceRepo!, 'Attendance');
			}

			// Claims import - SKIPPED per user request
			// if (this.shouldImport('claims')) {
			// 	await this.clearTable(this.claimRepo, 'Claims', Claim);
			// 	await this.copyEntities(this.claimSourceRepo!, this.claimRepo!, 'Claims');
			// }

			if (this.shouldImport('checkins')) {
				await this.clearTable(this.checkInRepo, 'Check-ins', CheckIn);
				await this.copyEntities(this.checkInSourceRepo!, this.checkInRepo!, 'Check-ins');
			}

			// Leads import - SKIPPED per user request
			// if (this.shouldImport('leads')) {
			// 	await this.clearTable(this.leadRepo, 'Leads', Lead);
			// 	await this.copyEntities(this.leadSourceRepo!, this.leadRepo!, 'Leads');
			// }

			// Quotations import - SKIPPED per user request
			// if (this.shouldImport('quotations')) {
			// 	await this.clearTable(this.quotationItemRepo, 'Quotation Items', QuotationItem);
			// 	await this.clearTable(this.quotationRepo, 'Quotations', Quotation);
			// 	await this.copyEntities(this.quotationSourceRepo!, this.quotationRepo!, 'Quotations');
			// 	await this.copyEntities(this.quotationItemSourceRepo!, this.quotationItemRepo!, 'Quotation Items');
			// }

			if (this.shouldImport('orders')) {
				await this.clearTable(this.orderItemRepo, 'Order Items', OrderItem);
				await this.clearTable(this.orderRepo, 'Orders', Order);
				await this.copyEntities(this.orderSourceRepo!, this.orderRepo!, 'Orders');
				await this.copyEntities(this.orderItemSourceRepo!, this.orderItemRepo!, 'Order Items');
			}

			// Tasks import - SKIPPED per user request
			// if (this.shouldImport('tasks')) {
			// 	await this.clearTable(this.subTaskRepo, 'Subtasks', SubTask);
			// 	await this.clearTable(this.taskRepo, 'Tasks', Task);
			// 	await this.copyEntities(this.taskSourceRepo!, this.taskRepo!, 'Tasks');
			// 	await this.copyEntities(this.subTaskSourceRepo!, this.subTaskRepo!, 'Subtasks');
			// }

			// Interactions import - SKIPPED per user request
			// if (this.shouldImport('interactions')) {
			// 	await this.clearTable(this.interactionRepo, 'Interactions', Interaction);
			// 	await this.copyEntities(this.interactionSourceRepo!, this.interactionRepo!, 'Interactions');
			// }

			// Notifications import - SKIPPED per user request
			// if (this.shouldImport('notifications')) {
			// 	await this.clearTable(this.notificationRepo, 'Notifications', Notification);
			// 	await this.copyEntities(this.notificationSourceRepo!, this.notificationRepo!, 'Notifications');
			// }

			if (this.shouldImport('journals')) {
				await this.clearTable(this.journalRepo, 'Journals', Journal);
				await this.copyEntities(this.journalSourceRepo!, this.journalRepo!, 'Journals');
			}

			// Leave import - SKIPPED per user request
			// if (this.shouldImport('leave')) {
			// 	await this.clearTable(this.leaveRepo, 'Leave', Leave);
			// 	await this.copyEntities(this.leaveSourceRepo!, this.leaveRepo!, 'Leave');
			// }

			// Warnings import - SKIPPED per user request
			// if (this.shouldImport('warnings')) {
			// 	await this.clearTable(this.warningRepo, 'Warnings', Warning);
			// 	await this.copyEntities(this.warningSourceRepo!, this.warningRepo!, 'Warnings');
			// }

			// Docs import - SKIPPED per user request
			// if (this.shouldImport('docs')) {
			// 	await this.clearTable(this.docRepo, 'Docs', Doc);
			// 	await this.copyEntities(this.docSourceRepo!, this.docRepo!, 'Docs');
			// }

			if (this.shouldImport('assets')) {
				await this.clearTable(this.assetRepo, 'Assets', Asset);
				await this.copyEntities(this.assetSourceRepo!, this.assetRepo!, 'Assets');
			}

			// News import - SKIPPED per user request
			// if (this.shouldImport('news')) {
			// 	await this.clearTable(this.newsRepo, 'News', News);
			// 	await this.copyEntities(this.newsSourceRepo!, this.newsRepo!, 'News');
			// }

			if (this.shouldImport('feedback')) {
				await this.clearTable(this.feedbackRepo, 'Feedback', Feedback);
				await this.copyEntities(this.feedbackSourceRepo!, this.feedbackRepo!, 'Feedback');
			}

			// Competitors import - SKIPPED per user request
			// if (this.shouldImport('competitors')) {
			// 	await this.clearTable(this.competitorRepo, 'Competitors', Competitor);
			// 	await this.copyEntities(this.competitorSourceRepo!, this.competitorRepo!, 'Competitors');
			// }

			if (this.shouldImport('resellers')) {
				await this.clearTable(this.resellerRepo, 'Resellers', Reseller);
				await this.copyEntities(this.resellerSourceRepo!, this.resellerRepo!, 'Resellers');
			}

			if (this.shouldImport('banners')) {
				await this.clearTable(this.bannersRepo, 'Banners', Banners);
				await this.copyEntities(this.bannersSourceRepo!, this.bannersRepo!, 'Banners');
			}

			if (this.shouldImport('projects')) {
				await this.clearTable(this.projectRepo, 'Projects', Project);
				await this.copyEntities(this.projectSourceRepo!, this.projectRepo!, 'Projects');
			}

			if (this.shouldImport('users')) {
				await this.clearTable(this.userRewardsRepo, 'User Rewards', UserRewards);
				await this.copyEntities(this.userRewardsSourceRepo!, this.userRewardsRepo!, 'User Rewards');
			}

			// Post-process user relationships after all entities are imported
			if (this.shouldImport('users')) {
				await this.postProcessUserRelationships();
			}

			// User Targets can be migrated independently (after users are migrated)
			// Note: Users must be migrated first for foreign key relationships to work
			if (this.shouldImport('usertargets')) {
				await this.clearTable(this.userTargetRepo, 'User Targets', UserTarget);
				await this.copyEntities(this.userTargetSourceRepo!, this.userTargetRepo!, 'User Targets');
			}

			// Skip tracking-related entities (tracking, geofence events)
			// These are intentionally skipped as per user request

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			this.printStats(duration);

		} catch (error) {
			console.error('\n❌ PostgreSQL-to-PostgreSQL migration failed:', error);
			throw error;
		}
	}

	private async copyEntities<T>(
		sourceRepo: Repository<T>,
		targetRepo: Repository<T>,
		entityName: string
	): Promise<void> {
		try {
			// Verify source repository is initialized
			if (!sourceRepo) {
				throw new Error(`Source repository for ${entityName} is not initialized`);
			}
			
			if (!sourceRepo.manager?.connection?.isInitialized) {
				throw new Error(`Source database connection for ${entityName} is not initialized`);
			}
			
			if (this.dryRun) {
				const count = await sourceRepo.count();
				console.log(`[DRY RUN] Would copy ${count} ${entityName} records`);
				return;
			}

			console.log(`\n📦 Copying ${entityName}...`);
			
			// Get table name from metadata
			const metadata = sourceRepo.metadata;
			const tableName = metadata.tableName;
			
			console.log(`  🔍 Querying table: ${tableName}`);
			const sourceOptions: any = sourceRepo.manager.connection.options;
			console.log(`  🔍 Source database: ${sourceOptions.database || sourceOptions.name || 'unknown'}`);
			console.log(`  🔍 Source host: ${sourceOptions.host || 'unknown'}`);
			
			// First, try to get a count to verify the table exists and has data
			try {
				const countResult = await sourceRepo.manager.connection.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
				const count = parseInt(countResult[0]?.count || '0', 10);
				console.log(`  📊 Record count from COUNT query: ${count}`);
			} catch (countError: any) {
				console.log(`  ⚠️  COUNT query failed: ${countError.message}`);
				// Try lowercase
				try {
					const countResult = await sourceRepo.manager.connection.query(`SELECT COUNT(*) as count FROM ${tableName.toLowerCase()}`);
					const count = parseInt(countResult[0]?.count || '0', 10);
					console.log(`  📊 Record count (lowercase): ${count}`);
				} catch (e) {
					console.log(`  ⚠️  COUNT query (lowercase) also failed: ${e.message}`);
				}
			}
			
			// Use raw query to get ALL columns including foreign keys
			// This ensures foreign key columns (ownerUid, organisationUid, etc.) are preserved exactly as-is
			const sourceDataSource = sourceRepo.manager.connection;
			
			// Try both quoted and unquoted table names (PostgreSQL is case-sensitive with quotes)
			let rawRecords: any[] = [];
			try {
				rawRecords = await sourceDataSource.query(`SELECT * FROM "${tableName}"`);
			} catch (error: any) {
				// If quoted name fails, try lowercase unquoted (PostgreSQL default)
				if (error.code === '42P01' || error.message?.includes('does not exist')) {
					console.log(`  ⚠️  Table "${tableName}" not found, trying lowercase: ${tableName.toLowerCase()}`);
					try {
						rawRecords = await sourceDataSource.query(`SELECT * FROM ${tableName.toLowerCase()}`);
					} catch (error2: any) {
						// Try with schema if needed
						console.log(`  ⚠️  Trying with public schema: public."${tableName}"`);
						try {
							rawRecords = await sourceDataSource.query(`SELECT * FROM public."${tableName}"`);
						} catch (error3: any) {
							// Last resort: use TypeORM's find() method
							console.log(`  ⚠️  Raw query failed, trying TypeORM find() method...`);
							const entities = await sourceRepo.find();
							// Convert entities to raw format for processing
							rawRecords = entities.map((entity: any) => {
								const raw: any = {};
								metadata.columns.forEach(column => {
									const propertyName = column.propertyName;
									raw[column.databaseName || propertyName] = entity[propertyName];
								});
								// Add foreign keys
								metadata.relations.forEach(relation => {
									const foreignKey = relation.joinColumns?.[0];
									if (foreignKey && entity[relation.propertyName]) {
										const fkValue = entity[relation.propertyName]?.uid || entity[relation.propertyName];
										raw[foreignKey.databaseName || foreignKey.propertyName] = fkValue;
									}
								});
								return raw;
							});
						}
					}
				} else {
					throw error;
				}
			}
			
			const total = rawRecords.length;
			console.log(`  📊 Found ${total} records in source table`);
			
			if (total === 0) {
				console.log(`  ⚠️  WARNING: No records found in source table "${tableName}"`);
				console.log(`  💡 Tip: Verify the table exists and has data in the source database`);
				const sourceOptions2: any = sourceRepo.manager.connection.options;
				console.log(`  💡 Source DB: ${sourceOptions2.database || sourceOptions2.name || 'unknown'}`);
				console.log(`  💡 Source Host: ${sourceOptions2.host || 'unknown'}`);
			} else if (total > 0 && this.verbose) {
				// Show sample of first record keys for debugging
				console.log(`  🔍 Sample record keys: ${Object.keys(rawRecords[0]).slice(0, 10).join(', ')}...`);
			}
			
			let imported = 0;
			let skipped = 0;
			let errors = 0;

			// Process in batches for better performance
			const batchSize = 100;
			for (let i = 0; i < rawRecords.length; i += batchSize) {
				const batch = rawRecords.slice(i, i + batchSize);
				
				try {
					// Reconstruct entities from raw data, preserving all columns and foreign keys
					const entityDataArray = batch.map((raw: any) => {
						const entityData: any = {};
						
						// Copy all scalar columns
						// PostgreSQL returns column names, check all possible variations
						metadata.columns.forEach(column => {
							const columnName = column.databaseName || column.propertyName;
							const propertyName = column.propertyName;
							
							// Try multiple naming patterns (PostgreSQL might return lowercase, TypeORM uses exact names)
							const possibleKeys = [
								columnName,                    // Exact database name
								columnName.toLowerCase(),      // Lowercase version
								propertyName,                  // Property name
								propertyName.toLowerCase(),    // Lowercase property
							];
							
							// Also check all keys in raw data for fuzzy matching
							const rawKeys = Object.keys(raw);
							for (const key of rawKeys) {
								if (key.toLowerCase() === columnName.toLowerCase() || 
								    key.toLowerCase() === propertyName.toLowerCase()) {
									entityData[propertyName] = raw[key];
									break;
								}
							}
							
							// Fallback: try exact matches
							for (const key of possibleKeys) {
								if (raw[key] !== undefined) {
									entityData[propertyName] = raw[key];
									break;
								}
							}
						});
						
						// Handle relationships by finding foreign key columns and setting them properly
						metadata.relations.forEach(relation => {
							const foreignKey = relation.joinColumns?.[0];
							if (foreignKey) {
								const fkColumnName = foreignKey.databaseName || foreignKey.propertyName;
								// Try multiple possible column name patterns
								const possibleKeys = [
									fkColumnName,
									`${relation.propertyName}Uid`,
									`${relation.propertyName}_id`,
									`${relation.propertyName}Id`,
									`${relation.propertyName}Ref`,
									`${relation.propertyName.toLowerCase()}Uid`,
									`${relation.propertyName.toLowerCase()}_id`,
								];
								
								let found = false;
								const relationName = relation.propertyName;
								
								// First try exact matches
								for (const key of possibleKeys) {
									if (raw[key] !== undefined && raw[key] !== null) {
										entityData[relationName] = { uid: raw[key] };
										found = true;
										if (this.verbose && i === 0 && batch.indexOf(raw) === 0) {
											console.log(`  🔗 Found ${relationName} foreign key: ${key} = ${raw[key]}`);
										}
										break;
									}
								}
								
								// If not found, try fuzzy matching on all keys
								if (!found) {
									const rawKeys = Object.keys(raw);
									for (const key of rawKeys) {
										const keyLower = key.toLowerCase();
										if ((keyLower.includes(relationName.toLowerCase()) && 
										     (keyLower.includes('uid') || keyLower.includes('id') || keyLower.includes('ref'))) ||
										    keyLower === fkColumnName.toLowerCase()) {
											if (raw[key] !== undefined && raw[key] !== null) {
												entityData[relationName] = { uid: raw[key] };
												found = true;
												if (this.verbose && i === 0 && batch.indexOf(raw) === 0) {
													console.log(`  🔗 Found ${relationName} foreign key (fuzzy): ${key} = ${raw[key]}`);
												}
												break;
											}
										}
									}
								}
								
								// If still not found, try to get it from the relation object if it exists
								if (!found && raw[relationName]) {
									const relObj = raw[relationName];
									if (relObj && typeof relObj === 'object' && relObj.uid) {
										entityData[relationName] = { uid: relObj.uid };
										if (this.verbose && i === 0 && batch.indexOf(raw) === 0) {
											console.log(`  🔗 Found ${relationName} from relation object: uid = ${relObj.uid}`);
										}
									}
								}
							}
						});
						
						return entityData;
					});
					
					await targetRepo.save(entityDataArray);
					imported += batch.length;
					if (this.verbose && (i + batchSize) % 500 === 0) {
						console.log(`  ✓ Imported ${imported}/${total} ${entityName}`);
					}
				} catch (error: any) {
					// If batch save fails, try individual saves with explicit foreign key handling
					for (const raw of batch) {
						try {
							const entityData: any = {};
							
							// Copy all scalar columns
							metadata.columns.forEach(column => {
								const columnName = column.databaseName || column.propertyName;
								const propertyName = column.propertyName;
								
								// Try multiple naming patterns
								const possibleKeys = [
									columnName,
									columnName.toLowerCase(),
									propertyName,
									propertyName.toLowerCase(),
								];
								
								// Check all keys in raw data for fuzzy matching
								const rawKeys = Object.keys(raw);
								for (const key of rawKeys) {
									if (key.toLowerCase() === columnName.toLowerCase() || 
									    key.toLowerCase() === propertyName.toLowerCase()) {
										entityData[propertyName] = raw[key];
										break;
									}
								}
								
								// Fallback: try exact matches
								for (const key of possibleKeys) {
									if (raw[key] !== undefined) {
										entityData[propertyName] = raw[key];
										break;
									}
								}
							});
							
							// Handle relationships
							metadata.relations.forEach(relation => {
								const foreignKey = relation.joinColumns?.[0];
								if (foreignKey) {
									const fkColumnName = foreignKey.databaseName || foreignKey.propertyName;
									const relationName = relation.propertyName;
									
									const possibleKeys = [
										fkColumnName,
										fkColumnName.toLowerCase(),
										`${relationName}Uid`,
										`${relationName}_id`,
										`${relationName}Id`,
										`${relationName}Ref`,
										`${relationName.toLowerCase()}Uid`,
										`${relationName.toLowerCase()}_id`,
										`${relationName.toLowerCase()}id`,
									];
									
									let found = false;
									
									// Try exact matches
									for (const key of possibleKeys) {
										if (raw[key] !== undefined && raw[key] !== null) {
											entityData[relationName] = { uid: raw[key] };
											found = true;
											break;
										}
									}
									
									// If not found, try fuzzy matching
									if (!found) {
										const rawKeys = Object.keys(raw);
										for (const key of rawKeys) {
											const keyLower = key.toLowerCase();
											if ((keyLower.includes(relationName.toLowerCase()) && 
											     (keyLower.includes('uid') || keyLower.includes('id') || keyLower.includes('ref'))) ||
											    keyLower === fkColumnName.toLowerCase()) {
												if (raw[key] !== undefined && raw[key] !== null) {
													entityData[relationName] = { uid: raw[key] };
													found = true;
													break;
												}
											}
										}
									}
									
									// If still not found, try relation object
									if (!found && raw[relationName]) {
										const relObj = raw[relationName];
										if (relObj && typeof relObj === 'object' && relObj.uid) {
											entityData[relationName] = { uid: relObj.uid };
										}
									}
								}
							});
							
							await targetRepo.save(entityData);
							imported++;
						} catch (individualError: any) {
							errors++;
							if (this.verbose && errors <= 10) {
								console.error(`  ❌ Error copying ${entityName} (uid: ${raw.uid || 'unknown'}): ${individualError.message}`);
							}
						}
					}
				}
			}

			console.log(`✅ ${entityName}: ${imported} copied, ${skipped} skipped, ${errors} errors`);
		} catch (error: any) {
			// Handle table not found errors gracefully
			if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('relation')) {
				console.log(`  ⚠️  ${entityName} table does not exist, skipping...`);
				return;
			}
			// Re-throw other errors
			throw error;
		}
	}

	private async copyAttendanceWithDateFilter(): Promise<void> {
		try {
			if (this.dryRun) {
				console.log(`[DRY RUN] Would copy attendance records for December 2024 only`);
				return;
			}

			console.log(`\n📦 Copying Attendance (filtered: December 2024 only)...`);
			
			// Get table name from metadata
			const metadata = this.attendanceSourceRepo!.metadata;
			const tableName = metadata.tableName;
			
			// Filter attendance records for December 2024 only
			const startDate = new Date('2024-12-01T00:00:00.000Z');
			const endDate = new Date('2024-12-31T23:59:59.999Z');
			
			// Use raw query with date filtering
			// Filter by checkIn date or createdAt date (whichever is available)
			const sourceDataSource = this.attendanceSourceRepo!.manager.connection;
			const rawRecords = await sourceDataSource.query(
				`SELECT * FROM "${tableName}" WHERE (("checkIn" >= $1 AND "checkIn" <= $2) OR ("checkIn" IS NULL AND "createdAt" >= $1 AND "createdAt" <= $2))`,
				[startDate.toISOString(), endDate.toISOString()]
			);
			
			const total = rawRecords.length;
			let imported = 0;
			let skipped = 0;
			let errors = 0;

			console.log(`Found ${total} attendance records (filtered for December 2024 only)`);

			// Process in batches for better performance
			const batchSize = 100;
			for (let i = 0; i < rawRecords.length; i += batchSize) {
				const batch = rawRecords.slice(i, i + batchSize);
				
				try {
					// Reconstruct entities from raw data, preserving all columns and foreign keys
					const entityDataArray = batch.map((raw: any) => {
						const entityData: any = {};
						
						// Copy all scalar columns
						metadata.columns.forEach(column => {
							const columnName = column.databaseName || column.propertyName;
							const propertyName = column.propertyName;
							
							const possibleKeys = [
								columnName,
								columnName.toLowerCase(),
								propertyName,
								propertyName.toLowerCase(),
							];
							
							const rawKeys = Object.keys(raw);
							for (const key of rawKeys) {
								if (key.toLowerCase() === columnName.toLowerCase() || 
								    key.toLowerCase() === propertyName.toLowerCase()) {
									entityData[propertyName] = raw[key];
									break;
								}
							}
							
							for (const key of possibleKeys) {
								if (raw[key] !== undefined) {
									entityData[propertyName] = raw[key];
									break;
								}
							}
						});
						
						// Handle relationships
						metadata.relations.forEach(relation => {
							const foreignKey = relation.joinColumns?.[0];
							if (foreignKey) {
								const fkColumnName = foreignKey.databaseName || foreignKey.propertyName;
								const possibleKeys = [
									fkColumnName,
									`${relation.propertyName}Uid`,
									`${relation.propertyName}_id`,
									`${relation.propertyName}Id`,
									`${relation.propertyName}Ref`,
									`${relation.propertyName.toLowerCase()}Uid`,
									`${relation.propertyName.toLowerCase()}_id`,
								];
								
								let found = false;
								const relationName = relation.propertyName;
								
								for (const key of possibleKeys) {
									if (raw[key] !== undefined && raw[key] !== null) {
										entityData[relationName] = { uid: raw[key] };
										found = true;
										break;
									}
								}
								
								if (!found) {
									const rawKeys = Object.keys(raw);
									for (const key of rawKeys) {
										const keyLower = key.toLowerCase();
										if ((keyLower.includes(relationName.toLowerCase()) && 
										     (keyLower.includes('uid') || keyLower.includes('id') || keyLower.includes('ref'))) ||
										    keyLower === fkColumnName.toLowerCase()) {
											if (raw[key] !== undefined && raw[key] !== null) {
												entityData[relationName] = { uid: raw[key] };
												found = true;
												break;
											}
										}
									}
								}
								
								if (!found && raw[relationName]) {
									const relObj = raw[relationName];
									if (relObj && typeof relObj === 'object' && relObj.uid) {
										entityData[relationName] = { uid: relObj.uid };
									}
								}
							}
						});
						
						return entityData;
					});
					
					await this.attendanceRepo!.save(entityDataArray);
					imported += batch.length;
					if (this.verbose && (i + batchSize) % 500 === 0) {
						console.log(`  ✓ Imported ${imported}/${total} Attendance`);
					}
				} catch (error: any) {
					// If batch save fails, try individual saves
					for (const raw of batch) {
						try {
							const entityData: any = {};
							
							metadata.columns.forEach(column => {
								const columnName = column.databaseName || column.propertyName;
								const propertyName = column.propertyName;
								
								const possibleKeys = [
									columnName,
									columnName.toLowerCase(),
									propertyName,
									propertyName.toLowerCase(),
								];
								
								const rawKeys = Object.keys(raw);
								for (const key of rawKeys) {
									if (key.toLowerCase() === columnName.toLowerCase() || 
									    key.toLowerCase() === propertyName.toLowerCase()) {
										entityData[propertyName] = raw[key];
										break;
									}
								}
								
								for (const key of possibleKeys) {
									if (raw[key] !== undefined) {
										entityData[propertyName] = raw[key];
										break;
									}
								}
							});
							
							metadata.relations.forEach(relation => {
								const foreignKey = relation.joinColumns?.[0];
								if (foreignKey) {
									const fkColumnName = foreignKey.databaseName || foreignKey.propertyName;
									const relationName = relation.propertyName;
									
									const possibleKeys = [
										fkColumnName,
										fkColumnName.toLowerCase(),
										`${relationName}Uid`,
										`${relationName}_id`,
										`${relationName}Id`,
										`${relationName}Ref`,
										`${relationName.toLowerCase()}Uid`,
										`${relationName.toLowerCase()}_id`,
									];
									
									let found = false;
									for (const key of possibleKeys) {
										if (raw[key] !== undefined && raw[key] !== null) {
											entityData[relationName] = { uid: raw[key] };
											found = true;
											break;
										}
									}
									
									if (!found) {
										const rawKeys = Object.keys(raw);
										for (const key of rawKeys) {
											const keyLower = key.toLowerCase();
											if ((keyLower.includes(relationName.toLowerCase()) && 
											     (keyLower.includes('uid') || keyLower.includes('id') || keyLower.includes('ref'))) ||
											    keyLower === fkColumnName.toLowerCase()) {
												if (raw[key] !== undefined && raw[key] !== null) {
													entityData[relationName] = { uid: raw[key] };
													found = true;
													break;
												}
											}
										}
									}
									
									if (!found && raw[relationName]) {
										const relObj = raw[relationName];
										if (relObj && typeof relObj === 'object' && relObj.uid) {
											entityData[relationName] = { uid: relObj.uid };
										}
									}
								}
							});
							
							await this.attendanceRepo!.save(entityData);
							imported++;
						} catch (individualError: any) {
							errors++;
							if (this.verbose && errors <= 10) {
								console.error(`  ❌ Error copying Attendance (uid: ${raw.uid || 'unknown'}): ${individualError.message}`);
							}
						}
					}
				}
			}

			console.log(`✅ Attendance: ${imported} copied, ${skipped} skipped, ${errors} errors`);
		} catch (error: any) {
			if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('relation')) {
				console.log(`  ⚠️  Attendance table does not exist, skipping...`);
				return;
			}
			throw error;
		}
	}

	/**
	 * Create default attendance records for all users
	 * - Past Saturday: 7 AM to 2 PM
	 * - Monday: 7 AM to 4:30 PM
	 * - Skip Tuesday
	 * - Today (Wednesday): Check-in between 6:30 AM and 6:55 AM (no check-out)
	 */
	private async createDefaultAttendanceRecords(): Promise<void> {
		try {
			if (this.dryRun) {
				console.log(`[DRY RUN] Would create default attendance records for all users`);
				return;
			}

			console.log(`\n📦 Creating default attendance records for all users...`);

			// Get all users from target database with relations
			const users = await this.userRepo!.find({
				where: { isDeleted: false },
				relations: ['organisation', 'branch'],
			});

			if (users.length === 0) {
				console.log(`  ⚠️  No users found, skipping attendance record creation`);
				return;
			}

			console.log(`  Found ${users.length} users`);

			// Calculate dates
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday

			// Find past Saturday (most recent Saturday before today)
			const pastSaturday = new Date(today);
			if (dayOfWeek === 0) {
				// If today is Sunday, Saturday was yesterday
				pastSaturday.setDate(today.getDate() - 1);
			} else if (dayOfWeek === 6) {
				// If today is Saturday, use today
				// pastSaturday is already today
			} else {
				// Otherwise, go back to the most recent Saturday
				pastSaturday.setDate(today.getDate() - (dayOfWeek + 1));
			}

			// Find Monday (most recent Monday)
			const monday = new Date(today);
			if (dayOfWeek === 0) {
				// If today is Sunday, Monday was 6 days ago
				monday.setDate(today.getDate() - 6);
			} else if (dayOfWeek === 1) {
				// If today is Monday, use today
				// monday is already today
			} else {
				// Otherwise, go back to the most recent Monday
				monday.setDate(today.getDate() - (dayOfWeek - 1));
			}

			console.log(`  📅 Past Saturday: ${pastSaturday.toDateString()}`);
			console.log(`  📅 Monday: ${monday.toDateString()}`);
			console.log(`  📅 Today: ${today.toDateString()} (Day of week: ${dayOfWeek})`);

			// Dummy location coordinates (Johannesburg area)
			const baseLat = -26.2041;
			const baseLng = 28.0473;

			let created = 0;
			let skipped = 0;
			let errors = 0;

			// Helper function to check if attendance record exists for a specific date
			const hasAttendanceForDate = async (userId: number, targetDate: Date): Promise<boolean> => {
				try {
					const startOfDay = new Date(targetDate);
					startOfDay.setHours(0, 0, 0, 0);
					const endOfDay = new Date(targetDate);
					endOfDay.setHours(23, 59, 59, 999);

					const existing = await this.attendanceRepo!.find({
						where: {
							owner: { uid: userId } as User,
						},
					});

					// Check if any record exists for this date
					return existing.some(record => {
						const recordDate = new Date(record.checkIn);
						recordDate.setHours(0, 0, 0, 0);
						return recordDate.getTime() === startOfDay.getTime();
					});
				} catch (error: any) {
					console.error(`  ⚠️  Error checking attendance for date: ${error.message}`);
					return false;
				}
			};

			// Helper function to create attendance record
			const createAttendanceRecord = async (
				user: User,
				checkIn: Date,
				checkOut: Date | null,
				duration: string | null,
				notes: string
			): Promise<boolean> => {
				try {
					const dummyLat = baseLat + (Math.random() * 0.1 - 0.05);
					const dummyLng = baseLng + (Math.random() * 0.1 - 0.05);

					const record = this.attendanceRepo!.create({
						status: AttendanceStatus.PRESENT,
						checkIn: checkIn,
						checkOut: checkOut,
						duration: duration,
						checkInLatitude: dummyLat,
						checkInLongitude: dummyLng,
						checkOutLatitude: checkOut ? dummyLat + 0.001 : null,
						checkOutLongitude: checkOut ? dummyLng + 0.001 : null,
						checkInNotes: notes,
						owner: { uid: user.uid } as User,
						organisation: { uid: user.organisation!.uid } as Organisation,
						...(user.branch && { branch: { uid: user.branch.uid } as Branch }),
					});

					await this.attendanceRepo!.save(record);
					return true;
				} catch (error: any) {
					console.error(`  ❌ Error saving attendance record: ${error.message}`);
					if (this.verbose) {
						console.error(`  Stack: ${error.stack}`);
					}
					return false;
				}
			};

			for (const user of users) {
				try {
					// Skip if user has no organisation
					if (!user.organisation) {
						if (this.verbose) console.log(`  ⏭️  Skipping user ${user.uid}: no organisation`);
						skipped += 3; // Count all three records as skipped
						continue;
					}

					// 1. Create Saturday attendance (7 AM to 2 PM)
					const satCheckIn = new Date(pastSaturday);
					satCheckIn.setHours(7, 0, 0, 0);
					const satCheckOut = new Date(pastSaturday);
					satCheckOut.setHours(14, 0, 0, 0);

					const hasSat = await hasAttendanceForDate(user.uid, pastSaturday);
					if (!hasSat) {
						const success = await createAttendanceRecord(
							user,
							satCheckIn,
							satCheckOut,
							'07:00:00',
							'Auto-generated attendance record - Saturday'
						);
						if (success) {
							created++;
							if (this.verbose) console.log(`  ✅ Created Saturday attendance for user ${user.uid}`);
						} else {
							errors++;
						}
					} else {
						skipped++;
						if (this.verbose) console.log(`  ⏭️  Skipped Saturday attendance for user ${user.uid} (already exists)`);
					}

					// 2. Create Monday attendance (7 AM to 4:30 PM)
					const monCheckIn = new Date(monday);
					monCheckIn.setHours(7, 0, 0, 0);
					const monCheckOut = new Date(monday);
					monCheckOut.setHours(16, 30, 0, 0);

					const hasMon = await hasAttendanceForDate(user.uid, monday);
					if (!hasMon) {
						const success = await createAttendanceRecord(
							user,
							monCheckIn,
							monCheckOut,
							'09:30:00',
							'Auto-generated attendance record - Monday'
						);
						if (success) {
							created++;
							if (this.verbose) console.log(`  ✅ Created Monday attendance for user ${user.uid}`);
						} else {
							errors++;
						}
					} else {
						skipped++;
						if (this.verbose) console.log(`  ⏭️  Skipped Monday attendance for user ${user.uid} (already exists)`);
					}

					// 3. Create today's attendance (if today is Wednesday) - check-in only
					if (dayOfWeek === 3) { // Wednesday
						// Random check-in time between 6:30 AM and 6:55 AM
						const randomMinutes = Math.floor(Math.random() * 26); // 0-25 minutes
						const randomSeconds = Math.floor(Math.random() * 60); // 0-59 seconds
						const todayCheckIn = new Date(today);
						todayCheckIn.setHours(6, 30 + randomMinutes, randomSeconds, 0);

						const hasToday = await hasAttendanceForDate(user.uid, today);
						if (!hasToday) {
							const success = await createAttendanceRecord(
								user,
								todayCheckIn,
								null,
								null,
								'Auto-generated attendance record - currently working'
							);
							if (success) {
								created++;
								if (this.verbose) {
									console.log(`  ✅ Created today's attendance for user ${user.uid} (check-in: ${todayCheckIn.toLocaleTimeString()})`);
								}
							} else {
								errors++;
							}
						} else {
							skipped++;
							if (this.verbose) console.log(`  ⏭️  Skipped today's attendance for user ${user.uid} (already exists)`);
						}
					}

					// Progress logging
					if ((created + skipped + errors) % 50 === 0) {
						console.log(`  📊 Progress: ${created} created, ${skipped} skipped, ${errors} errors`);
					}

				} catch (error: any) {
					errors++;
					console.error(`  ❌ Error processing user ${user.uid}: ${error.message}`);
					if (this.verbose) {
						console.error(`  Stack: ${error.stack}`);
					}
				}
			}

			console.log(`✅ Default Attendance Records: ${created} created, ${skipped} skipped, ${errors} errors`);
		} catch (error: any) {
			console.error(`  ❌ Error in createDefaultAttendanceRecords: ${error.message}`);
			if (this.verbose) {
				console.error(`  Stack: ${error.stack}`);
			}
			throw error;
		}
	}

	private shouldImport(entity: string): boolean {
		if (this.onlyEntities.length === 0) return true;
		return this.onlyEntities.includes(entity);
	}

	private async importOrganisations() {
		console.log('\n📦 Importing Organisations...');
		
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM organisation WHERE isDeleted = 0');
		const orgs = rows as any[];
		this.stats.organisations.total = orgs.length;

		console.log(`Found ${orgs.length} organisations`);

		for (const org of orgs) {
			try {
				if (this.dryRun) {
					this.stats.organisations.imported++;
					continue;
				}

				// Check if already exists
				const existing = await this.orgRepo!.findOne({ where: { ref: org.ref } });
				if (existing) {
					this.orgMapping[org.uid] = existing.uid;
					this.stats.organisations.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped existing org: ${org.name} (${org.ref})`);
					continue;
				}

				// Parse address JSON
				let address = { street: '', suburb: '', city: '', state: '', country: '', postalCode: '' };
				if (org.address) {
					try {
						address = typeof org.address === 'string' ? JSON.parse(org.address) : org.address;
					} catch (e) {
						console.warn(`  ⚠️  Invalid address JSON for org ${org.uid}, using defaults`);
					}
				}

				const newOrg = this.orgRepo!.create({
					name: org.name || 'Unknown Organisation',
					email: org.email || `org${org.uid}@example.com`,
					phone: org.phone || '',
					website: org.website || '',
					logo: org.logo || '',
					address,
					status: (org.status as GeneralStatus) || GeneralStatus.ACTIVE,
					ref: org.ref || `ORG${org.uid}`,
					alias: org.alias || null,
					isDeleted: false,
				});

				const saved = await this.orgRepo!.save(newOrg);
				this.orgMapping[org.uid] = saved.uid;
				this.stats.organisations.imported++;

				if (this.verbose) console.log(`  ✅ Imported: ${saved.name} (${saved.ref})`);
			} catch (error: any) {
				this.stats.organisations.errors++;
				console.error(`  ❌ Error importing org ${org.uid}: ${error.message}`);
			}
		}

		console.log(`✅ Organisations: ${this.stats.organisations.imported} imported, ${this.stats.organisations.skipped} skipped, ${this.stats.organisations.errors} errors\n`);
	}

	private async importBranches() {
		console.log('\n📦 Importing Branches...');
		
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM branch');
		const branches = rows as any[];
		this.stats.branches.total = branches.length;

		console.log(`Found ${branches.length} branches`);
		
		// Debug: Find organisation reference column by inspecting first branch
		let orgColumnName: string | null = null;
		if (branches.length > 0) {
			const sampleBranch = branches[0];
			const allKeys = Object.keys(sampleBranch);
			
			// Try to find organisation-related column
			const possibleNames = [
				'organisationRef', 'organisationUid', 'organisation_id', 'organisationId',
				'orgRef', 'orgUid', 'org_id', 'orgId', 'organisationRef'
			];
			
			for (const name of possibleNames) {
				if (sampleBranch[name] !== undefined && sampleBranch[name] !== null) {
					orgColumnName = name;
					break;
				}
			}
			
			// If not found, search case-insensitively
			if (!orgColumnName) {
				for (const key of allKeys) {
					const lowerKey = key.toLowerCase();
					if ((lowerKey.includes('org') || lowerKey.includes('organisation')) && 
						!lowerKey.includes('name') && !lowerKey.includes('email')) {
						orgColumnName = key;
						break;
					}
				}
			}
			
			if (orgColumnName) {
				console.log(`  🔍 Found organisation column: ${orgColumnName}`);
			} else {
				console.warn(`  ⚠️  Could not find organisation column. Available keys: ${allKeys.slice(0, 10).join(', ')}...`);
				if (this.verbose) {
					console.log(`  🔍 All branch keys:`, allKeys);
				}
			}
		}

		for (const branch of branches) {
			try {
				if (this.dryRun) {
					this.stats.branches.imported++;
					continue;
				}

				// Check if already exists
				const existing = await this.branchRepo!.findOne({ where: { ref: branch.ref } });
				if (existing) {
					this.branchMapping[branch.uid] = existing.uid;
					this.stats.branches.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped existing branch: ${branch.name} (${branch.ref})`);
					continue;
				}

				// Map organisation - use detected column name or try common variations
				const orgRef = orgColumnName 
					? branch[orgColumnName]
					: (branch.organisationRef || branch.organisationUid || branch.organisation_id || branch.organisationId || branch.orgUid || branch.org_id);
				let orgUid: number | undefined;
				
				if (orgRef !== undefined && orgRef !== null) {
					// Try as number first
					const orgRefNum = typeof orgRef === 'number' ? orgRef : parseInt(String(orgRef), 10);
					orgUid = this.orgMapping[orgRefNum] || this.orgMapping[orgRef as any];
				}
				
				// If still not found, try to find by organisation relation if it exists
				if (!orgUid && branch.organisation) {
					const orgRefFromRelation = typeof branch.organisation === 'object' 
						? (branch.organisation.uid || branch.organisation.ref)
						: branch.organisation;
					if (orgRefFromRelation) {
						const orgRefNum = typeof orgRefFromRelation === 'number' ? orgRefFromRelation : parseInt(String(orgRefFromRelation), 10);
						orgUid = this.orgMapping[orgRefNum] || this.orgMapping[orgRefFromRelation as any];
					}
				}
				
				// If still not found and we have orgs, use the first one as fallback
				if (!orgUid && Object.keys(this.orgMapping).length > 0) {
					const firstOrgUid = Object.values(this.orgMapping)[0];
					if (this.verbose) console.warn(`  ⚠️  Branch ${branch.uid} has no organisation mapping, using first org ${firstOrgUid} as fallback`);
					orgUid = firstOrgUid;
				}
				
				if (!orgUid) {
					this.stats.branches.skipped++;
					console.warn(`  ⚠️  Skipped branch ${branch.uid}: organisation not found (orgRef: ${orgRef}, available orgs: ${Object.keys(this.orgMapping).length})`);
					if (this.verbose) {
						console.log(`  🔍 Debug - branch data:`, {
							uid: branch.uid,
							name: branch.name,
							organisationRef: branch.organisationRef,
							organisationUid: branch.organisationUid,
							organisation_id: branch.organisation_id,
							organisation: branch.organisation,
						});
					}
					continue;
				}

				// Parse address JSON
				let address = { street: '', suburb: '', city: '', state: '', country: '', postalCode: '' };
				if (branch.address) {
					try {
						address = typeof branch.address === 'string' ? JSON.parse(branch.address) : branch.address;
					} catch (e) {
						console.warn(`  ⚠️  Invalid address JSON for branch ${branch.uid}, using defaults`);
					}
				}

				const newBranch = this.branchRepo!.create({
					name: branch.name || 'Unknown Branch',
					email: branch.email || `branch${branch.uid}@example.com`,
					phone: branch.phone || '',
					contactPerson: branch.contactPerson || '',
					ref: branch.ref || `BRN${branch.uid}`,
					address,
					website: branch.website || '',
					status: (branch.status as GeneralStatus) || GeneralStatus.ACTIVE,
					alias: branch.alias || null,
					country: branch.country || 'SA',
					isDeleted: false,
					organisation: { uid: orgUid } as Organisation,
				});

				const saved = await this.branchRepo!.save(newBranch);
				this.branchMapping[branch.uid] = saved.uid;
				this.stats.branches.imported++;

				if (this.verbose) console.log(`  ✅ Imported: ${saved.name} (${saved.ref})`);
			} catch (error: any) {
				this.stats.branches.errors++;
				console.error(`  ❌ Error importing branch ${branch.uid}: ${error.message}`);
			}
		}

		console.log(`✅ Branches: ${this.stats.branches.imported} imported, ${this.stats.branches.skipped} skipped, ${this.stats.branches.errors} errors\n`);
	}

	private async importUsers() {
		console.log('\n📦 Importing Users...');
		
		const [rows] = await this.executeWithRetry<any>('SELECT * FROM users');
		const users = rows;
		this.stats.users.total = users.length;

		console.log(`Found ${users.length} users`);

		for (let i = 0; i < users.length; i++) {
			const user = users[i];
			const progress = `${i + 1}/${users.length}`;
			
			try {
				if (this.dryRun) {
					this.stats.users.imported++;
					if ((i + 1) % 100 === 0 || i === users.length - 1) {
						process.stdout.write(`\r  Processing: ${progress}`);
					}
					continue;
				}

				// Check if already exists
				const existing = await this.userRepo!.findOne({ where: { email: user.email } });
				if (existing) {
					// Check if we should update (compare updatedAt)
					const shouldUpdate = user.updatedAt && existing.updatedAt && 
						new Date(user.updatedAt) > new Date(existing.updatedAt);
					
					if (shouldUpdate) {
						// Update existing user with latest data
						existing.name = user.name || existing.name;
						existing.surname = user.surname || existing.surname;
						existing.phone = user.phone || existing.phone;
						existing.photoURL = user.photoURL || existing.photoURL;
						existing.avatar = user.avatar || existing.avatar;
						existing.status = user.status || existing.status;
						
						// Store managedStaff for post-processing
						if (user.managedStaff) {
							this.pendingManagedStaffUpdates.set(existing.uid, user.managedStaff);
						}
						
						await this.userRepo!.save(existing);
						this.stats.users.updated++;
					} else {
						this.stats.users.duplicates++;
					}
					
					this.userMapping[user.uid] = existing.uid;
					if ((i + 1) % 100 === 0 || i === users.length - 1) {
						process.stdout.write(`\r  Processing: ${progress}`);
					}
					continue;
				}

				// Map organisation and branch
				const orgRef = user.organisationRef ? String(user.organisationRef) : null;
				const orgUid = orgRef ? (this.orgMapping[parseInt(orgRef, 10)] || this.orgMapping[orgRef as any]) : null;
				
				const branchUid = user.branchUid ? this.branchMapping[user.branchUid] : null;

				// Map managedBranches - ensure proper number array
				const managedBranches = this.parseAndMapNumberArray(
					user.managedBranches,
					this.branchMapping,
					'managedBranches',
					user.uid,
					true
				);

				// Map managedStaff - skip in first pass (circular dependency), will be updated in post-processing
				// Store original for later processing
				const originalManagedStaff = user.managedStaff;

				// Map managedDoors (device IDs) - preserve original values even if device mappings don't exist
				// This ensures all data is copied as-is from MySQL
				const managedDoors = this.parseAndMapNumberArray(
					user.managedDoors || user.managed_doors || user.doors || user.deviceIds,
					this.deviceMapping,
					'managedDoors',
					user.uid,
					true,
					true // preserveOriginalIfNoMapping = true to copy all data as-is
				);

				// Map assignedClientIds - if clients are being migrated
				const assignedClientIds = this.parseAndMapNumberArray(
					user.assignedClientIds || user.assigned_client_ids || user.assignedClients || user.clientIds,
					{}, // TODO: Add clientMapping if clients are migrated
					'assignedClientIds',
					user.uid,
					true
				);

				// Parse preferences if exists, otherwise use defaults
				let preferences: any = {
					theme: 'light' as const,
					language: 'en',
					notifications: true,
					shiftAutoEnd: false,
				};
				
				if (user.preferences) {
					try {
						const parsedPrefs = typeof user.preferences === 'string' 
							? JSON.parse(user.preferences) 
							: user.preferences;
						if (parsedPrefs && typeof parsedPrefs === 'object' && !Array.isArray(parsedPrefs)) {
							preferences = { ...preferences, ...parsedPrefs };
						}
					} catch (e) {
						// Use defaults on error
					}
				}

				// Preserve ALL fields from MySQL - use fallbacks only when truly missing
				const newUser: User = this.userRepo!.create({
					username: this.preserveFieldWithFallback(user.username, user.email?.split('@')[0] || `user${user.uid}`),
					password: this.preserveFieldWithFallback(user.password, '$2b$10$defaultpasswordhash'),
					name: this.preserveFieldWithFallback(user.name, ''),
					surname: this.preserveFieldWithFallback(user.surname, ''),
					email: this.preserveFieldWithFallback(user.email, `user${user.uid}@example.com`),
					phone: this.preserveField(user.phone),
					photoURL: 'https://cdn-icons-png.flaticon.com/128/1144/1144709.png',
					avatar: 'https://cdn-icons-png.flaticon.com/128/1144/1144709.png',
					role: this.preserveFieldWithFallback(user.role, 'user'),
					status: this.preserveFieldWithFallback(user.status, 'active'),
					departmentId: this.preserveField(user.departmentId),
					accessLevel: (user.accessLevel as AccessLevel) || AccessLevel.USER,
					organisationRef: orgUid ? String(orgUid) : null,
					hrID: this.preserveField(user.hrID),
					managedBranches: managedBranches,
					managedStaff: null, // Will be set in post-processing after all users are imported
					managedDoors: managedDoors,
					assignedClientIds: assignedClientIds,
					preferences,
					// Preserve additional fields that might exist in MySQL but not explicitly mapped
					...(user.businesscardURL && { businesscardURL: user.businesscardURL }),
					...(user.verificationToken && { verificationToken: user.verificationToken }),
					...(user.resetToken && { resetToken: user.resetToken }),
					...(user.tokenExpires && { tokenExpires: user.tokenExpires }),
					...(user.expoPushToken && { expoPushToken: user.expoPushToken }),
					...(user.deviceId && { deviceId: user.deviceId }),
					...(user.platform && { platform: user.platform }),
					...(user.pushTokenUpdatedAt && { pushTokenUpdatedAt: user.pushTokenUpdatedAt }),
					...(orgUid && { organisation: { uid: orgUid } as Organisation }),
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				} as DeepPartial<User>);

				const saved: User = await this.userRepo!.save(newUser);
				this.userMapping[user.uid] = saved.uid;
				
				// Store original managedStaff for post-processing
				if (originalManagedStaff) {
					this.pendingManagedStaffUpdates.set(saved.uid, originalManagedStaff);
				}
				
				this.stats.users.imported++;

				if ((i + 1) % 100 === 0 || i === users.length - 1) {
					process.stdout.write(`\r  Processing: ${progress}`);
				}
			} catch (error: any) {
				this.stats.users.errors++;
				console.error(`\n  ❌ Error importing user ${user.uid}: ${error.message}`);
			}
		}

		console.log(`\n✅ Users: ${this.stats.users.imported} imported, ${this.stats.users.skipped} skipped, ${this.stats.users.duplicates} duplicates, ${this.stats.users.updated} updated, ${this.stats.users.errors} errors`);
	}

	private async importUserProfiles() {
		console.log('\n📦 Importing User Profiles...');
		
		const [rows] = await this.executeWithRetry<any>('SELECT * FROM user_profile');
		const profiles = rows;
		this.stats.userProfiles.total = profiles.length;

		console.log(`Found ${profiles.length} user profiles`);

		for (const profile of profiles) {
			try {
				const newUserId = this.userMapping[profile.owner];
				if (!newUserId) {
					this.stats.userProfiles.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped profile: user ${profile.owner} not found`);
					continue;
				}

				if (this.dryRun) {
					this.stats.userProfiles.imported++;
					continue;
				}

				// Check if profile already exists
				const existing = await this.userProfileRepo!.findOne({ 
					where: { owner: { uid: newUserId } as User } 
				});
				if (existing) {
					this.stats.userProfiles.skipped++;
					continue;
				}

				const newProfile = this.userProfileRepo!.create({
					height: profile.height || null,
					weight: profile.weight || null,
					hairColor: profile.hairColor || null,
					eyeColor: profile.eyeColor || null,
					gender: profile.gender || null,
					ethnicity: profile.ethnicity || null,
					bodyType: profile.bodyType || null,
					smokingHabits: profile.smokingHabits || null,
					drinkingHabits: profile.drinkingHabits || null,
					dateOfBirth: profile.dateOfBirth || null,
					address: profile.address || null,
					city: profile.city || null,
					country: profile.country || null,
					zipCode: profile.zipCode || null,
					aboutMe: profile.aboutMe || null,
					socialMedia: profile.socialMedia || null,
					currentAge: profile.currentAge || null,
					maritalStatus: profile.maritalStatus || null,
					numberDependents: profile.numberDependents || null,
					shoeSize: profile.shoeSize || null,
					shirtSize: profile.shirtSize || null,
					pantsSize: profile.pantsSize || null,
					dressSize: profile.dressSize || null,
					coatSize: profile.coatSize || null,
					owner: { uid: newUserId } as User,
				});

				await this.userProfileRepo!.save(newProfile);
				this.stats.userProfiles.imported++;

				if (this.verbose) console.log(`  ✅ Imported profile for user ${newUserId}`);
			} catch (error: any) {
				this.stats.userProfiles.errors++;
				console.error(`  ❌ Error importing profile ${profile.uid}: ${error.message}`);
			}
		}

		console.log(`✅ User Profiles: ${this.stats.userProfiles.imported} imported, ${this.stats.userProfiles.skipped} skipped, ${this.stats.userProfiles.errors} errors\n`);
	}

	private async importUserEmploymentProfiles() {
		console.log('\n📦 Importing User Employment Profiles...');
		
		const [rows] = await this.executeWithRetry<any>('SELECT * FROM user_employeement_profile');
		const profiles = rows;
		this.stats.userEmploymentProfiles.total = profiles.length;

		console.log(`Found ${profiles.length} employment profiles`);

		for (const profile of profiles) {
			try {
				const newUserId = this.userMapping[profile.owner];
				if (!newUserId) {
					this.stats.userEmploymentProfiles.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped employment profile: user ${profile.owner} not found`);
					continue;
				}

				if (this.dryRun) {
					this.stats.userEmploymentProfiles.imported++;
					continue;
				}

				// Check if profile already exists
				const existing = await this.userEmploymentRepo!.findOne({ 
					where: { owner: { uid: newUserId } as User } 
				});
				if (existing) {
					this.stats.userEmploymentProfiles.skipped++;
					continue;
				}

				const newProfile = this.userEmploymentRepo!.create({
					startDate: profile.startDate || null,
					endDate: profile.endDate || null,
					branchref: profile.branchref || null,
					department: profile.department || null,
					position: profile.position || null,
					email: profile.email || null,
					contactNumber: profile.contactNumber || null,
					isCurrentlyEmployed: profile.isCurrentlyEmployed !== undefined ? profile.isCurrentlyEmployed : true,
					owner: { uid: newUserId } as User,
				});

				const savedProfile = await this.userEmploymentRepo!.save(newProfile);
				this.stats.userEmploymentProfiles.imported++;

				// Link the employment profile back to the user
				const user = await this.userRepo!.findOne({ where: { uid: newUserId } });
				if (user) {
					user.userEmployeementProfile = savedProfile;
					await this.userRepo!.save(user);
				}

				if (this.verbose) console.log(`  ✅ Imported employment profile for user ${newUserId}`);
			} catch (error: any) {
				this.stats.userEmploymentProfiles.errors++;
				console.error(`  ❌ Error importing employment profile ${profile.uid}: ${error.message}`);
			}
		}

		console.log(`✅ User Employment Profiles: ${this.stats.userEmploymentProfiles.imported} imported, ${this.stats.userEmploymentProfiles.skipped} skipped, ${this.stats.userEmploymentProfiles.errors} errors\n`);
	}

	private async importUserTargets() {
		console.log('\n📦 Importing User Targets...');
		
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM user_targets');
		const targets = rows as any[];
		this.stats.userTargets.total = targets.length;

		console.log(`Found ${targets.length} user targets`);

		for (let i = 0; i < targets.length; i++) {
			const target = targets[i];
			const progress = `${i + 1}/${targets.length}`;
			
			try {
				// Map user - try multiple field names including userTargetUid
				// Check all possible column names that might exist in MySQL
				const oldUserId = target.userTargetUid || target.user || target.owner || target.ownerUid || target.owner_id || target.user_id || target.userUid || target.userId;
				
				if (!oldUserId && this.verbose) {
					console.warn(`  ⚠️  UserTarget ${target.uid} has no user reference. Available fields: ${Object.keys(target).join(', ')}`);
				}
				
				const newUserId = oldUserId ? this.userMapping[oldUserId] : null;
				
				if (!newUserId) {
					if (oldUserId && this.verbose) {
						console.warn(`  ⚠️  UserTarget ${target.uid} references user ${oldUserId} which was not found in userMapping`);
					}
					this.stats.userTargets.skipped++;
					if ((i + 1) % 100 === 0 || i === targets.length - 1) {
						process.stdout.write(`\r  Processing: ${progress}`);
					}
					continue;
				}

				if (this.dryRun) {
					this.stats.userTargets.imported++;
					if ((i + 1) % 100 === 0 || i === targets.length - 1) {
						process.stdout.write(`\r  Processing: ${progress}`);
					}
					continue;
				}

				// Check if target already exists - use ownerUID for proper linking
				const existing = await this.userTargetRepo!.findOne({ 
					where: { user: { uid: newUserId } as User },
					relations: ['user']
				});
				
				if (existing) {
					// Check if we should update (compare updatedAt)
					const shouldUpdate = target.updatedAt && existing.updatedAt && 
						new Date(target.updatedAt) > new Date(existing.updatedAt);
					
					if (shouldUpdate) {
						// Update existing target with latest data
						existing.targetSalesAmount = target.targetSalesAmount ?? existing.targetSalesAmount;
						existing.currentSalesAmount = target.currentSalesAmount ?? existing.currentSalesAmount;
						existing.targetQuotationsAmount = target.targetQuotationsAmount ?? existing.targetQuotationsAmount;
						existing.currentQuotationsAmount = target.currentQuotationsAmount ?? existing.currentQuotationsAmount;
						existing.targetPeriod = target.targetPeriod ?? existing.targetPeriod;
						await this.userTargetRepo!.save(existing);
						this.stats.userTargets.updated++;
					} else {
						this.stats.userTargets.duplicates++;
					}
					
					if ((i + 1) % 100 === 0 || i === targets.length - 1) {
						process.stdout.write(`\r  Processing: ${progress}`);
					}
					continue;
				}

				// Parse history JSON
				let history: any[] = [];
				if (target.history) {
					try {
						history = typeof target.history === 'string' ? JSON.parse(target.history) : target.history;
						if (!Array.isArray(history)) history = [];
					} catch (e) {
						console.warn(`  ⚠️  Invalid history JSON for target ${target.uid}`);
					}
				}

				// Create UserTarget with ALL fields from MySQL, preserving original values
				// The relationship to User is established via user: { uid: newUserId }
				// This ensures all row data is copied as-is from MySQL
				const newTarget = this.userTargetRepo!.create({
					targetSalesAmount: target.targetSalesAmount ?? null,
					currentSalesAmount: target.currentSalesAmount ?? null,
					targetQuotationsAmount: target.targetQuotationsAmount ?? null,
					currentQuotationsAmount: target.currentQuotationsAmount ?? null,
					currentOrdersAmount: target.currentOrdersAmount ?? null,
					targetCurrency: target.targetCurrency || 'ZAR',
					targetHoursWorked: target.targetHoursWorked ?? null,
					currentHoursWorked: target.currentHoursWorked ?? null,
					targetNewClients: target.targetNewClients ?? null,
					currentNewClients: target.currentNewClients ?? null,
					targetNewLeads: target.targetNewLeads ?? null,
					currentNewLeads: target.currentNewLeads ?? null,
					targetCheckIns: target.targetCheckIns ?? null,
					currentCheckIns: target.currentCheckIns ?? null,
					targetCalls: target.targetCalls ?? null,
					currentCalls: target.currentCalls ?? null,
					baseSalary: target.baseSalary ?? null,
					carInstalment: target.carInstalment ?? null,
					carInsurance: target.carInsurance ?? null,
					fuel: target.fuel ?? null,
					cellPhoneAllowance: target.cellPhoneAllowance ?? null,
					carMaintenance: target.carMaintenance ?? null,
					cgicCosts: target.cgicCosts ?? null,
					totalCost: target.totalCost ?? null,
					targetPeriod: target.targetPeriod ?? null,
					periodStartDate: target.periodStartDate ?? null,
					periodEndDate: target.periodEndDate ?? null,
					lastCalculatedAt: target.lastCalculatedAt ?? null,
					isRecurring: target.isRecurring !== undefined ? target.isRecurring : true,
					recurringInterval: target.recurringInterval || 'monthly',
					carryForwardUnfulfilled: target.carryForwardUnfulfilled !== undefined ? target.carryForwardUnfulfilled : false,
					nextRecurrenceDate: target.nextRecurrenceDate ?? null,
					lastRecurrenceDate: target.lastRecurrenceDate ?? null,
					recurrenceCount: target.recurrenceCount ?? 0,
					erpSalesRepCode: target.erpSalesRepCode ?? null,
					history,
					// Establish relationship to User using mapped UID
					// This will set the foreign key column in user_targets table
					user: { uid: newUserId } as User,
				} as DeepPartial<UserTarget>);

				await this.userTargetRepo!.save(newTarget);
				this.stats.userTargets.imported++;

				if ((i + 1) % 100 === 0 || i === targets.length - 1) {
					process.stdout.write(`\r  Processing: ${progress}`);
				}
			} catch (error: any) {
				this.stats.userTargets.errors++;
				console.error(`\n  ❌ Error importing target ${target.uid}: ${error.message}`);
			}
		}

		console.log(`\n✅ User Targets: ${this.stats.userTargets.imported} imported, ${this.stats.userTargets.skipped} skipped, ${this.stats.userTargets.duplicates} duplicates, ${this.stats.userTargets.updated} updated, ${this.stats.userTargets.errors} errors`);
	}

	/**
	 * Post-process user relationships after all entities are imported
	 * - Updates managedDoors with device mappings
	 * - Updates managedStaff with user mappings (handles circular dependencies)
	 * - Verifies managedBranches mappings
	 * - Links UserTarget, UserProfile, UserEmploymentProfile, UserRewards back to User
	 */
	private async postProcessUserRelationships(): Promise<void> {
		console.log('\n🔗 Post-processing user relationships...');
		
		if (this.dryRun) {
			console.log('[DRY RUN] Would update user relationships');
			return;
		}

		const users = await this.userRepo!.find({
			relations: ['userTarget', 'userProfile', 'userEmployeementProfile', 'rewards']
		});

		let updated = 0;
		for (const user of users) {
			let needsUpdate = false;
			const updates: any = {};

			// 1. Update managedDoors with device mappings (devices are now imported)
			if (user.managedDoors && user.managedDoors.length > 0 && Object.keys(this.deviceMapping).length > 0) {
				const mappedDoors = user.managedDoors
					.map((oldDeviceId: number) => this.deviceMapping[oldDeviceId] || oldDeviceId)
					.filter((id: number) => id !== null && id !== undefined);
				
				if (JSON.stringify(mappedDoors) !== JSON.stringify(user.managedDoors)) {
					updates.managedDoors = mappedDoors;
					needsUpdate = true;
				}
			}

			// 2. Update managedStaff with user mappings (all users are now imported)
			const pendingStaff = this.pendingManagedStaffUpdates.get(user.uid);
			if (pendingStaff) {
				const mappedStaff = this.parseAndMapNumberArray(
					pendingStaff,
					this.userMapping,
					'managedStaff',
					user.uid,
					true
				);
				if (mappedStaff && mappedStaff.length > 0) {
					updates.managedStaff = mappedStaff;
					needsUpdate = true;
				}
				this.pendingManagedStaffUpdates.delete(user.uid);
			} else if (user.managedStaff && user.managedStaff.length > 0) {
				// Also check existing managedStaff for unmapped values
				const mappedStaff = user.managedStaff
					.map((oldUserId: number) => this.userMapping[oldUserId] || oldUserId)
					.filter((id: number) => id !== null && id !== undefined);
				
				if (JSON.stringify(mappedStaff) !== JSON.stringify(user.managedStaff)) {
					updates.managedStaff = mappedStaff;
					needsUpdate = true;
				}
			}

			// 3. Update managedBranches (verify mappings)
			if (user.managedBranches && user.managedBranches.length > 0) {
				const mappedBranches = user.managedBranches
					.map((oldBranchId: number) => this.branchMapping[oldBranchId] || oldBranchId)
					.filter((id: number) => id !== null && id !== undefined);
				
				if (JSON.stringify(mappedBranches) !== JSON.stringify(user.managedBranches)) {
					updates.managedBranches = mappedBranches;
					needsUpdate = true;
				}
			}

			// 4. Link UserTarget if it exists but isn't linked
			if (!user.userTarget) {
				const userTarget = await this.userTargetRepo!.findOne({
					where: { user: { uid: user.uid } }
				});
				if (userTarget) {
					updates.userTarget = userTarget;
					needsUpdate = true;
				}
			}

			// 5. Link UserProfile if it exists but isn't linked
			if (!user.userProfile) {
				const userProfile = await this.userProfileRepo!.findOne({
					where: { owner: { uid: user.uid } }
				});
				if (userProfile) {
					updates.userProfile = userProfile;
					needsUpdate = true;
				}
			}

			// 6. Link UserEmploymentProfile if it exists but isn't linked
			if (!user.userEmployeementProfile) {
				const employmentProfile = await this.userEmploymentRepo!.findOne({
					where: { owner: { uid: user.uid } }
				});
				if (employmentProfile) {
					updates.userEmployeementProfile = employmentProfile;
					needsUpdate = true;
				}
			}

			// 7. Link UserRewards if it exists but isn't linked
			if (!user.rewards) {
				const rewards = await this.userRewardsRepo!.findOne({
					where: { owner: { uid: user.uid } }
				});
				if (rewards) {
					updates.rewards = rewards;
					needsUpdate = true;
				}
			}

			if (needsUpdate) {
				Object.assign(user, updates);
				await this.userRepo!.save(user);
				updated++;
				if (this.verbose && updated % 100 === 0) {
					console.log(`  ✓ Updated ${updated} user relationships...`);
				}
			}
		}

		console.log(`✅ Post-processed ${updated} user relationships\n`);
	}

	private async importUserRewards() {
		console.log('\n📦 Importing User Rewards...');
		
		try {
			const [rows] = await this.mysqlConnection!.execute('SELECT * FROM user_rewards');
			const rewards = rows as any[];
			this.stats.userRewards.total = rewards.length;

			console.log(`Found ${rewards.length} user rewards`);

			for (let i = 0; i < rewards.length; i++) {
				const reward = rewards[i];
				const progress = `${i + 1}/${rewards.length}`;
				
				try {
					// Map user - try multiple field names for owner reference
					const oldUserId = reward.owner || reward.ownerUid || reward.owner_id || reward.user || reward.user_id;
					const newUserId = oldUserId ? this.userMapping[oldUserId] : null;
					
					if (!newUserId) {
						this.stats.userRewards.skipped++;
						if ((i + 1) % 100 === 0 || i === rewards.length - 1) {
							process.stdout.write(`\r  Processing: ${progress}`);
						}
						continue;
					}

					if (this.dryRun) {
						this.stats.userRewards.imported++;
						if ((i + 1) % 100 === 0 || i === rewards.length - 1) {
							process.stdout.write(`\r  Processing: ${progress}`);
						}
						continue;
					}

					// Check if reward already exists - ensure proper linking via ownerUID
					const existing = await this.userRewardsRepo!.findOne({ 
						where: { owner: { uid: newUserId } as User },
						relations: ['owner']
					});
					
					if (existing) {
						// Check if we should update (compare updatedAt)
						const shouldUpdate = reward.updatedAt && existing.updatedAt && 
							new Date(reward.updatedAt) > new Date(existing.updatedAt);
						
						if (shouldUpdate) {
							// Update existing reward with latest data
							existing.currentXP = reward.currentXP ?? existing.currentXP;
							existing.totalXP = reward.totalXP ?? existing.totalXP;
							existing.level = reward.level ?? existing.level;
							existing.rank = reward.rank ?? existing.rank;
							if (reward.xpBreakdown) {
								try {
									const breakdown = typeof reward.xpBreakdown === 'string' 
										? JSON.parse(reward.xpBreakdown) 
										: reward.xpBreakdown;
									if (breakdown && typeof breakdown === 'object') {
										existing.xpBreakdown = breakdown;
									}
								} catch (e) {
									// Keep existing breakdown on parse error
								}
							}
							await this.userRewardsRepo!.save(existing);
							this.stats.userRewards.updated++;
						} else {
							this.stats.userRewards.duplicates++;
						}
						
						if ((i + 1) % 100 === 0 || i === rewards.length - 1) {
							process.stdout.write(`\r  Processing: ${progress}`);
						}
						continue;
					}

					// Parse xpBreakdown JSON
					let xpBreakdown = {
						tasks: 0,
						leads: 0,
						sales: 0,
						attendance: 0,
						collaboration: 0,
						login: 0,
						other: 0,
					};
					if (reward.xpBreakdown) {
						try {
							const parsed = typeof reward.xpBreakdown === 'string' 
								? JSON.parse(reward.xpBreakdown) 
								: reward.xpBreakdown;
							if (parsed && typeof parsed === 'object') {
								xpBreakdown = { ...xpBreakdown, ...parsed };
							}
						} catch (e) {
							// Use defaults on error
						}
					}

					const newReward = this.userRewardsRepo!.create({
						currentXP: reward.currentXP || 0,
						totalXP: reward.totalXP || 0,
						level: reward.level || 1,
						rank: reward.rank || 'ROOKIE',
						xpBreakdown,
						lastAction: reward.lastAction || reward.updatedAt || reward.createdAt || new Date(),
						createdAt: reward.createdAt || new Date(),
						updatedAt: reward.updatedAt || new Date(),
						owner: { uid: newUserId } as User, // Proper linking via ownerUID
					});

					const savedReward = await this.userRewardsRepo!.save(newReward);
					this.stats.userRewards.imported++;

					// Link the rewards back to the user
					const user = await this.userRepo!.findOne({ where: { uid: newUserId } });
					if (user) {
						user.rewards = savedReward;
						await this.userRepo!.save(user);
					}

					if ((i + 1) % 100 === 0 || i === rewards.length - 1) {
						process.stdout.write(`\r  Processing: ${progress}`);
					}
				} catch (error: any) {
					this.stats.userRewards.errors++;
					console.error(`\n  ❌ Error importing user reward ${reward.uid}: ${error.message}`);
				}
			}

			console.log(`\n✅ User Rewards: ${this.stats.userRewards.imported} imported, ${this.stats.userRewards.skipped} skipped, ${this.stats.userRewards.duplicates} duplicates, ${this.stats.userRewards.updated} updated, ${this.stats.userRewards.errors} errors`);
		} catch (error: any) {
			if (error.code === 'ER_NO_SUCH_TABLE') {
				console.log(`⚠️  Table 'user_rewards' does not exist, skipping...`);
				this.stats.userRewards.total = 0;
				console.log(`✅ User Rewards: 0 imported, 0 skipped, 0 errors\n`);
			} else {
				throw error;
			}
		}
	}

	private async importDevices() {
		console.log('\n📦 Importing Devices...');
		
		const [rows] = await this.executeWithRetry<any>('SELECT * FROM device');
		const devices = rows;
		this.stats.devices.total = devices.length;

		console.log(`Found ${devices.length} devices`);

		for (const device of devices) {
			try {
				if (this.dryRun) {
					this.stats.devices.imported++;
					continue;
				}

				// Check if already exists by deviceID (unique identifier)
				const deviceID = device.deviceID || `DEVICE${device.id}`;
				const existing = await this.deviceRepo!.findOne({ 
					where: { deviceID, isDeleted: false } 
				});
				
				if (existing) {
					this.deviceMapping[device.id] = existing.id;
					this.stats.devices.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped existing device: ${deviceID}`);
					continue;
				}

				// Map organisation and branch
				const orgUid = this.orgMapping[device.orgID];
				const branchUid = this.branchMapping[device.branchID];
				
				if (!orgUid || !branchUid) {
					this.stats.devices.skipped++;
					console.warn(`  ⚠️  Skipped device ${device.id}: org ${device.orgID} or branch ${device.branchID} not found`);
					continue;
				}

				// Parse analytics JSON
				let analytics = {
					openCount: 0,
					closeCount: 0,
					totalCount: 0,
					lastOpenAt: null as Date | null,
					lastCloseAt: null as Date | null,
					onTimeCount: 0,
					lateCount: 0,
					daysAbsent: 0,
				};
				if (device.analytics) {
					try {
						const parsed = typeof device.analytics === 'string' ? JSON.parse(device.analytics) : device.analytics;
						analytics = { ...analytics, ...parsed };
					} catch (e) {
						console.warn(`  ⚠️  Invalid analytics JSON for device ${device.id}, using defaults`);
					}
				}

				const newDevice = this.deviceRepo!.create({
					orgID: orgUid,
					branchID: device.branchID,
					branchUid,
					deviceID: device.deviceID || `DEVICE${device.id}`,
					deviceType: (device.deviceType as DeviceType) || DeviceType.DOOR_SENSOR,
					deviceIP: device.deviceIP || '0.0.0.0',
					devicePort: device.devicePort || 80,
					devicLocation: device.devicLocation || '',
					deviceTag: device.deviceTag || '',
					currentStatus: (device.currentStatus as DeviceStatus) || DeviceStatus.ONLINE,
					isDeleted: false,
					analytics,
					organisation: { uid: orgUid } as Organisation,
					branch: { uid: branchUid } as Branch,
				});

				const saved = await this.deviceRepo!.save(newDevice);
				this.deviceMapping[device.id] = saved.id;
				this.stats.devices.imported++;

				if (this.verbose) console.log(`  ✅ Imported: ${saved.deviceID} (${saved.id})`);
			} catch (error: any) {
				this.stats.devices.errors++;
				console.error(`  ❌ Error importing device ${device.id}: ${error.message}`);
			}
		}

		console.log(`✅ Devices: ${this.stats.devices.imported} imported, ${this.stats.devices.skipped} skipped, ${this.stats.devices.errors} errors\n`);
	}

	private async clearDeviceRecordsAndLogs() {
		console.log('\n🧹 Clearing Device Records and Logs...');
		
		if (this.dryRun) {
			console.log('  ⏭️  DRY RUN - Would clear device records and logs');
			return;
		}

		try {
			// Use clearTable with CASCADE to handle foreign key dependencies
			if (this.deviceLogsRepo) {
				await this.clearTable(this.deviceLogsRepo, 'Device Logs', DeviceLogs);
			}
			if (this.deviceRecordsRepo) {
				await this.clearTable(this.deviceRecordsRepo, 'Device Records', DeviceRecords);
			}
			
			console.log('✅ Device Records and Logs cleared\n');
		} catch (error: any) {
			console.error(`  ❌ Error clearing device records and logs: ${error.message}`);
			throw error;
		}
	}

	private async importDeviceRecords() {
		console.log('\n📦 Importing Device Records...');
		
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM device_records');
		const records = rows as any[];
		this.stats.deviceRecords.total = records.length;

		console.log(`Found ${records.length} device records`);

		for (const record of records) {
			try {
				// Handle both camelCase and snake_case column names from MySQL
				const oldDeviceId = record.deviceId || record.device_id;
				const newDeviceId = oldDeviceId ? this.deviceMapping[oldDeviceId] : null;
				
				if (!newDeviceId) {
					this.stats.deviceRecords.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped record: device ${oldDeviceId} not found`);
					continue;
				}

				if (this.dryRun) {
					this.stats.deviceRecords.imported++;
					continue;
				}

				// Check for duplicate record (same device, openTime, and closeTime)
				const openTime = record.openTime || null;
				const closeTime = record.closeTime || null;
				
				const existing = await this.deviceRecordsRepo!.findOne({
					where: {
						deviceId: newDeviceId,
						openTime: openTime,
						closeTime: closeTime,
					}
				});
				
				if (existing) {
					this.stats.deviceRecords.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate record: device ${newDeviceId}, openTime: ${openTime}, closeTime: ${closeTime}`);
					continue;
				}

				const newRecord = this.deviceRecordsRepo!.create({
					openTime: openTime,
					closeTime: closeTime,
					deviceId: newDeviceId,
					device: { id: newDeviceId } as Device,
				});

				await this.deviceRecordsRepo!.save(newRecord);
				this.stats.deviceRecords.imported++;

				if (this.verbose && this.stats.deviceRecords.imported % 100 === 0) {
					console.log(`  📊 Imported ${this.stats.deviceRecords.imported} records...`);
				}
			} catch (error: any) {
				this.stats.deviceRecords.errors++;
				if (this.verbose) console.error(`  ❌ Error importing record ${record.id}: ${error.message}`);
			}
		}

		console.log(`✅ Device Records: ${this.stats.deviceRecords.imported} imported, ${this.stats.deviceRecords.skipped} skipped, ${this.stats.deviceRecords.errors} errors\n`);
	}

	private async importLicenses() {
		console.log('\n📦 Importing Licenses...');
		
		// Use retry logic for MySQL query
		const [rows] = await this.executeWithRetry<any>('SELECT * FROM licenses');
		const licenses = rows;
		this.stats.licenses.total = licenses.length;

		console.log(`Found ${licenses.length} licenses`);

		for (const license of licenses) {
			try {
				if (this.dryRun) {
					this.stats.licenses.imported++;
					continue;
				}

				// Check if already exists by licenseKey (primary duplicate check)
				const existing = await this.licenseRepo!.findOne({ 
					where: { licenseKey: license.licenseKey } 
				});
				
				if (existing) {
					this.licenseMapping[license.uid] = existing.uid;
					this.stats.licenses.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped existing license: ${license.licenseKey}`);
					continue;
				}
				
				// Additional check: if licenseKey is missing, check by organisation and type to avoid duplicates
				if (!license.licenseKey) {
					const orgRef = license.organisationRef || license.organisationUid || license.organisation_id;
					const orgUid = orgRef ? (this.orgMapping[orgRef] || this.orgMapping[parseInt(String(orgRef), 10)]) : null;
					
					if (orgUid) {
						const existingByOrg = await this.licenseRepo!.findOne({
							where: {
								organisation: { uid: orgUid } as Organisation,
								type: (license.type as LicenseType) || LicenseType.PERPETUAL,
							}
						});
						
						if (existingByOrg) {
							this.licenseMapping[license.uid] = existingByOrg.uid;
							this.stats.licenses.skipped++;
							if (this.verbose) console.log(`  ⏭️  Skipped duplicate license for org ${orgUid}`);
							continue;
						}
					}
				}

				// Map organisation
				const orgRef = license.organisationRef || license.organisationUid || license.organisation_id;
				const orgUid = orgRef ? (this.orgMapping[orgRef] || this.orgMapping[parseInt(String(orgRef), 10)]) : null;
				
				if (!orgUid) {
					this.stats.licenses.skipped++;
					console.warn(`  ⚠️  Skipped license ${license.uid}: organisation ${orgRef} not found`);
					continue;
				}

				// Parse features JSON
				let features: Record<string, boolean> = {};
				if (license.features) {
					try {
						features = typeof license.features === 'string' ? JSON.parse(license.features) : license.features;
						if (typeof features !== 'object' || Array.isArray(features)) {
							features = {};
						}
					} catch (e) {
						console.warn(`  ⚠️  Invalid features JSON for license ${license.uid}, using empty object`);
					}
				}

				// Map enum values with defaults
				const type = (license.type as LicenseType) || LicenseType.PERPETUAL;
				const plan = (license.plan as SubscriptionPlan) || SubscriptionPlan.STARTER;
				const status = (license.status as LicenseStatus) || LicenseStatus.ACTIVE;
				const billingCycle = (license.billingCycle as BillingCycle) || BillingCycle.MONTHLY;

				const newLicense = this.licenseRepo!.create({
					licenseKey: license.licenseKey || `LIC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
					type,
					plan,
					status,
					billingCycle,
					validUntil: license.validUntil || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year
					lastValidated: license.lastValidated || null,
					maxUsers: license.maxUsers || 10,
					maxBranches: license.maxBranches || 1,
					storageLimit: license.storageLimit || 1024, // Default 1GB
					apiCallLimit: license.apiCallLimit || 10000,
					integrationLimit: license.integrationLimit || 5,
					features,
					price: license.price || 0,
					organisationRef: orgUid,
					hasPendingPayments: license.hasPendingPayments || false,
					organisation: { uid: orgUid } as Organisation,
					isDeleted: false,
				});

				const saved = await this.licenseRepo!.save(newLicense);
				this.licenseMapping[license.uid] = saved.uid;
				this.stats.licenses.imported++;

				if (this.verbose) console.log(`  ✅ Imported: ${saved.licenseKey} (${saved.plan})`);
			} catch (error: any) {
				this.stats.licenses.errors++;
				console.error(`  ❌ Error importing license ${license.uid}: ${error.message}`);
			}
		}

		console.log(`✅ Licenses: ${this.stats.licenses.imported} imported, ${this.stats.licenses.skipped} skipped, ${this.stats.licenses.errors} errors\n`);
	}

	// Helper method to execute MySQL queries with retry logic
	private async executeWithRetry<T = any>(
		query: string,
		params?: any[],
		maxRetries: number = 3,
		retryDelay: number = 2000
	): Promise<[T[], any]> {
		let lastError: any;
		let currentRetryDelay = retryDelay;
		
		// #region agent log
		fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:1683',message:'executeWithRetry entry',data:{query:query.substring(0,50),maxRetries,hasConnection:!!this.mysqlConnection},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
		// #endregion
		
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				// Check connection state before executing
				if (!this.mysqlConnection) {
					// #region agent log
					fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:1693',message:'Connection is null, reconnecting',data:{attempt},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
					// #endregion
					await this.reconnectMySQL();
				}
				
				// #region agent log
				const connState = this.mysqlConnection ? (this.mysqlConnection as any).state : 'null';
				fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:1700',message:'Before query execution',data:{attempt,connState,hasConnection:!!this.mysqlConnection},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
				// #endregion
				
				const queryStartTime = Date.now();
				const result = await Promise.race([
					this.mysqlConnection!.execute(query, params),
					new Promise<never>((_, reject) => 
						setTimeout(() => reject(new Error('Query timeout after 60 seconds')), 60000)
					)
				]);
				
				// #region agent log
				fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:1700',message:'Query succeeded',data:{attempt,duration:Date.now()-queryStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
				// #endregion
				
				return result as [T[], any];
			} catch (error: any) {
				lastError = error;
				
				// #region agent log
				const connStateAfterError = this.mysqlConnection ? (this.mysqlConnection as any).state : 'null';
				const isClosed = error.message?.includes('closed state') || connStateAfterError === 'closed' || connStateAfterError === 'disconnected';
				fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:1702',message:'Query error caught',data:{attempt,errorMsg:error.message,errorCode:error.code,connStateAfterError,isClosed,hasConnection:!!this.mysqlConnection},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
				// #endregion
				
				// Check for various timeout indicators
				const isTimeout = 
					error.code === 'ETIMEDOUT' || 
					error.errno === -60 || // macOS timeout error code
					error.message?.includes('timeout') ||
					error.message?.includes('ETIMEDOUT') ||
					error.message?.includes('timed out');
				
				// Check if connection is closed - mysql2 throws "Can't add new command when connection is in closed state"
				const connectionClosed = error.message?.includes('closed state') || 
					error.message?.includes('connection is closed') ||
					error.message?.includes('Cannot enqueue') ||
					(this.mysqlConnection && (this.mysqlConnection as any).state === 'closed') ||
					(this.mysqlConnection && (this.mysqlConnection as any).state === 'disconnected');
				
				// #region agent log
				fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:1711',message:'Error analysis',data:{attempt,isTimeout,connectionClosed,willRetry:isTimeout && attempt < maxRetries && !connectionClosed},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
				// #endregion
				
				// If connection is closed, always try to reconnect (regardless of timeout)
				if (connectionClosed && attempt < maxRetries) {
					// #region agent log
					fetch('http://127.0.0.1:7242/ingest/0ce50f7b-4196-43a5-93ca-ac3c9cf1f6b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'migrate-legacy-db.ts:1725',message:'Connection closed detected, attempting reconnect',data:{attempt,isTimeout},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
					// #endregion
					
					console.warn(`  ⚠️  Connection closed (attempt ${attempt}/${maxRetries}), reconnecting...`);
					await this.reconnectMySQL();
					await new Promise(resolve => setTimeout(resolve, currentRetryDelay));
					// Exponential backoff
					currentRetryDelay = Math.min(currentRetryDelay * 1.5, 30000); // Cap at 30 seconds
					continue;
				}
				
				if (isTimeout && attempt < maxRetries) {
					console.warn(`  ⚠️  Query timeout (attempt ${attempt}/${maxRetries}), retrying in ${currentRetryDelay}ms...`);
					await new Promise(resolve => setTimeout(resolve, currentRetryDelay));
					// Exponential backoff
					currentRetryDelay = Math.min(currentRetryDelay * 1.5, 30000); // Cap at 30 seconds
					continue;
				}
				
				// If not a timeout or last attempt, throw immediately
				if (!isTimeout || attempt === maxRetries) {
					throw error;
				}
			}
		}
		
		throw lastError;
	}

	// Helper method to safely map UIDs
	private mapUid(oldUid: number | string | null | undefined, mapping: UidMapping): number | null {
		if (!oldUid) return null;
		const uid = typeof oldUid === 'number' ? oldUid : parseInt(String(oldUid), 10);
		return mapping[uid] || null;
	}

	// Helper method to parse JSON safely
	private parseJSON<T>(value: any, defaultValue: T): T {
		if (!value) return defaultValue;
		try {
			const parsed = typeof value === 'string' ? JSON.parse(value) : value;
			return parsed as T;
		} catch {
			return defaultValue;
		}
	}

	// Helper method to preserve field value - returns actual value or null, never defaults
	// This ensures we import ALL data from MySQL, including nulls and empty strings
	private preserveField<T>(value: any, defaultValue: T | null = null): T | null {
		// Preserve null and undefined as-is
		if (value === null || value === undefined) {
			return defaultValue;
		}
		// Preserve empty strings, 0, false as-is (don't use || operator)
		return value as T;
	}

	// Helper method to preserve field with fallback only if truly missing
	private preserveFieldWithFallback<T>(value: any, fallback: T): T {
		// Only use fallback if value is null, undefined, or empty string
		if (value === null || value === undefined || value === '') {
			return fallback;
		}
		return value as T;
	}

	// Helper method to parse and map JSON array fields (for number arrays)
	private parseAndMapNumberArray(
		value: any,
		mapping: UidMapping | IdMapping,
		fieldName: string,
		entityUid: number,
		allowEmpty: boolean = true,
		preserveOriginalIfNoMapping: boolean = false
	): number[] | null {
		if (!value) return allowEmpty ? null : [];
		
		try {
			let parsed: any;
			
			// Handle different input formats from MySQL
			if (typeof value === 'string') {
				const trimmed = value.trim();
				if (!trimmed) return allowEmpty ? null : [];
				
				// Try JSON parse first
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					// If JSON parse fails, try comma-separated string
					if (trimmed.includes(',')) {
						// Split and preserve all values, including empty ones for logging
						parsed = trimmed.split(',').map((v: string) => {
							const trimmedVal = v.trim();
							// Preserve the value even if empty for debugging
							return trimmedVal === '' ? null : trimmedVal;
						}).filter((v: any) => v !== null); // Only filter out null, not falsy values
					} else if (trimmed) {
						// Single value - preserve as-is
						parsed = [trimmed];
					} else {
						return allowEmpty ? null : [];
					}
				}
			} else if (Array.isArray(value)) {
				parsed = value;
			} else if (typeof value === 'number') {
				// Single number value
				parsed = [value];
			} else {
				if (this.verbose) {
					console.warn(`  ⚠️  ${fieldName} has unexpected type for entity ${entityUid}: ${typeof value}`);
				}
				return allowEmpty ? null : [];
			}

			// Ensure it's an array
			if (!Array.isArray(parsed)) {
				if (this.verbose) {
					console.warn(`  ⚠️  ${fieldName} is not an array for entity ${entityUid}, got: ${typeof parsed}`);
				}
				return allowEmpty ? null : [];
			}

			// Map old UIDs to new UIDs and ensure all values are numbers
			// IMPORTANT: Preserve all valid values, including 0
			const mapped: number[] = [];
			for (const item of parsed) {
				// Preserve the original value first
				let numUid: number | null = null;
				
				if (typeof item === 'string') {
					const trimmed = item.trim();
					// Don't filter out empty strings here - check if it's a valid number
					if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
						continue; // Skip empty/invalid string values
					}
					const parsedNum = parseInt(trimmed, 10);
					if (!isNaN(parsedNum)) {
						numUid = parsedNum;
					}
				} else if (typeof item === 'number') {
					// Preserve all numbers including 0
					numUid = item;
				} else if (item === null || item === undefined) {
					continue; // Skip null/undefined
				}
				
				if (numUid === null || isNaN(numUid)) {
					if (this.verbose) {
						console.warn(`  ⚠️  Invalid ${fieldName} value for entity ${entityUid}: ${item} (type: ${typeof item})`);
					}
					continue;
				}
				
				// Map to new UID - preserve 0 values
				const newUid = mapping[numUid];
				if (newUid !== undefined && newUid !== null && typeof newUid === 'number') {
					mapped.push(newUid);
				} else {
					// If preserveOriginalIfNoMapping is true, keep the original value even if no mapping exists
					// This ensures all data is copied as-is from MySQL
					if (preserveOriginalIfNoMapping) {
						mapped.push(numUid);
						if (this.verbose) {
							console.warn(`  ⚠️  ${fieldName} UID ${numUid} not found in mapping for entity ${entityUid} (preserving original value)`);
						}
					} else if (this.verbose) {
						console.warn(`  ⚠️  ${fieldName} UID ${numUid} not found in mapping for entity ${entityUid} (will be skipped)`);
					}
				}
			}

			// Return null for empty arrays if allowEmpty is true, otherwise return empty array
			return mapped.length > 0 ? mapped : (allowEmpty ? null : []);
		} catch (e: any) {
			if (this.verbose) {
				console.warn(`  ⚠️  Error parsing ${fieldName} for entity ${entityUid}: ${e.message}`);
			}
			return allowEmpty ? null : [];
		}
	}

	/**
	 * Generic helper to clear table before import to avoid duplicates
	 * Uses TRUNCATE CASCADE to handle foreign key dependencies automatically
	 */
	private async clearTable<T>(
		repo: Repository<T> | null,
		entityName: string,
		EntityClass: any
	): Promise<void> {
		if (!repo) {
			console.warn(`  ⚠️  Repository for ${entityName} not available, skipping clear`);
			return;
		}

		console.log(`\n🧹 Clearing ${entityName}...`);
		
		if (this.dryRun) {
			console.log(`  ⏭️  DRY RUN - Would clear ${entityName}`);
			return;
		}

		try {
			// Get table name from entity metadata
			let metadata;
			try {
				metadata = this.pgDataSource!.getMetadata(EntityClass);
			} catch (metadataError: any) {
				// Entity not registered in DataSource - skip clearing
				if (metadataError.name === 'EntityMetadataNotFoundError') {
					console.warn(`  ⚠️  Entity ${entityName} not registered in DataSource, skipping clear`);
					return;
				}
				throw metadataError;
			}
			
			const tableName = metadata.tableName;
			
			// Use TRUNCATE CASCADE RESTART IDENTITY to:
			// 1. Delete all dependent rows in child tables (CASCADE)
			// 2. Reset auto-increment sequences to start from 1 (RESTART IDENTITY)
			await this.pgDataSource!.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`);
			
			console.log(`  ✅ Cleared ${entityName} records and reset sequences (with CASCADE)`);
		} catch (error: any) {
			// If it's a table not found error, skip gracefully
			if (error.code === '42P01' || error.message?.includes('does not exist')) {
				console.warn(`  ⚠️  Table for ${entityName} does not exist, skipping clear`);
				return;
			}
			console.error(`  ❌ Error clearing ${entityName}: ${error.message}`);
			throw error;
		}
	}

	private async clearAttendanceRecords() {
		await this.clearTable(this.attendanceRepo, 'Attendance', Attendance);
	}

	private async importAttendance() {
		console.log('\n📦 Importing Attendance...');
		// Import attendance records for December only
		const startDate = new Date('2024-12-01T00:00:00.000Z');
		const endDate = new Date('2024-12-31T23:59:59.999Z');
		// Filter by checkIn date if available, otherwise use createdAt
		const [rows] = await this.mysqlConnection!.execute(
			'SELECT * FROM attendance WHERE ((checkIn >= ? AND checkIn <= ?) OR (checkIn IS NULL AND createdAt >= ? AND createdAt <= ?))',
			[startDate, endDate, startDate, endDate]
		);
		const records = rows as any[];
		this.stats.attendance.total = records.length;
		console.log(`Found ${records.length} attendance records (importing records for December 2024 only)`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.attendance.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid || record.organisation_id, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);
				const verifiedByUid = this.mapUid(record.verifiedBy || record.verifiedByUid || record.verifiedBy_id, this.userMapping);
				const dailyReportUid = this.mapUid(record.dailyReport || record.dailyReportUid || record.dailyReport_id || record.reportUid || record.report_id, this.reportMapping);

				if (!ownerUid) {
					this.stats.attendance.skipped++;
					continue;
				}

				// Check for duplicate attendance record (same owner and checkIn time)
				const checkInTime = record.checkIn || record.createdAt || new Date();
				const existing = await this.attendanceRepo!.findOne({
					where: {
						owner: { uid: ownerUid } as User,
						checkIn: checkInTime,
					}
				});

				if (existing) {
					this.stats.attendance.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate attendance: owner ${ownerUid}, checkIn: ${checkInTime}`);
					continue;
				}

				// Preserve ALL fields from MySQL - parse JSON fields but preserve all other data as-is
				const placesOfInterest = this.parseJSON(record.placesOfInterest, null);
				const breakDetails = this.parseJSON(record.breakDetails, []);

				const newRecord: Attendance = this.attendanceRepo!.create({
					status: (record.status as AttendanceStatus) || AttendanceStatus.PRESENT,
					checkIn: record.checkIn || record.createdAt || new Date(), // Date fields need special handling
					checkOut: this.preserveField(record.checkOut),
					duration: this.preserveField(record.duration),
					overtime: this.preserveField(record.overtime),
					earlyMinutes: this.preserveField(record.earlyMinutes) ?? 0, // Use ?? to preserve 0
					lateMinutes: this.preserveField(record.lateMinutes) ?? 0,
					checkInLatitude: this.preserveField(record.checkInLatitude),
					checkInLongitude: this.preserveField(record.checkInLongitude),
					checkOutLatitude: this.preserveField(record.checkOutLatitude),
					checkOutLongitude: this.preserveField(record.checkOutLongitude),
					placesOfInterest, // Already parsed JSON
					checkInNotes: this.preserveField(record.checkInNotes),
					checkOutNotes: this.preserveField(record.checkOutNotes),
					breakStartTime: this.preserveField(record.breakStartTime),
					breakEndTime: this.preserveField(record.breakEndTime),
					totalBreakTime: this.preserveField(record.totalBreakTime),
					breakCount: this.preserveField(record.breakCount) ?? 0,
					breakDetails, // Already parsed JSON
					breakLatitude: this.preserveField(record.breakLatitude),
					breakLongitude: this.preserveField(record.breakLongitude),
					breakNotes: this.preserveField(record.breakNotes),
					distanceTravelledKm: this.preserveField(record.distanceTravelledKm) ?? 0,
					createdAt: this.preserveField(record.createdAt) || new Date(),
					updatedAt: this.preserveField(record.updatedAt) || new Date(),
					verifiedAt: this.preserveField(record.verifiedAt),
					owner: { uid: ownerUid } as User,
					...(orgUid && { organisation: { uid: orgUid } as Organisation }),
					...(branchUid && { branch: { uid: branchUid } as Branch }),
					...(verifiedByUid && { verifiedBy: { uid: verifiedByUid } as User }),
					...(dailyReportUid && { dailyReport: { uid: dailyReportUid } as Report }),
				} as unknown as DeepPartial<Attendance>);

				await this.attendanceRepo!.save(newRecord);
				this.stats.attendance.imported++;
			} catch (error: any) {
				this.stats.attendance.errors++;
				if (this.verbose) console.error(`  ❌ Error importing attendance ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Attendance: ${this.stats.attendance.imported} imported, ${this.stats.attendance.skipped} skipped, ${this.stats.attendance.errors} errors\n`);
	}

	private async importClaims() {
		console.log('\n📦 Importing Claims...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM claim');
		const records = rows as any[];
		this.stats.claims.total = records.length;
		console.log(`Found ${records.length} claims`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.claims.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid) {
					this.stats.claims.skipped++;
					continue;
				}

				// Check for duplicate claim (same owner, amount, and verifiedAt/createdAt)
				const verifiedAt = record.verifiedAt || record.createdAt || new Date();
				const existing = await this.claimRepo!.findOne({
					where: {
						owner: { uid: ownerUid } as User,
						amount: record.amount || '0',
						verifiedAt: verifiedAt,
					}
				});

				if (existing) {
					this.stats.claims.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate claim: owner ${ownerUid}, amount: ${record.amount}, verifiedAt: ${verifiedAt}`);
					continue;
				}

				const newRecord = this.claimRepo!.create({
					amount: record.amount || '0',
					documentUrl: record.documentUrl || null,
					verifiedAt: record.verifiedAt || record.createdAt || new Date(),
					comments: record.comments || null,
					status: record.status || 'PENDING',
					category: record.category || 'GENERAL',
					currency: record.currency || 'ZAR',
					owner: { uid: ownerUid } as User,
					...(orgUid && { organisation: { uid: orgUid } as Organisation }),
					...(branchUid && { branch: { uid: branchUid } as Branch }),
					isDeleted: false,
				});

				await this.claimRepo!.save(newRecord);
				this.stats.claims.imported++;
			} catch (error: any) {
				this.stats.claims.errors++;
				if (this.verbose) console.error(`  ❌ Error importing claim ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Claims: ${this.stats.claims.imported} imported, ${this.stats.claims.skipped} skipped, ${this.stats.claims.errors} errors\n`);
	}

	private async importCheckIns() {
		console.log('\n📦 Importing Check-ins...');
		let records: any[];
		try {
			const [rows] = await this.mysqlConnection!.execute('SELECT * FROM check_ins');
			records = rows as any[];
			this.stats.checkIns.total = records.length;
			console.log(`Found ${records.length} check-ins`);
		} catch (error: any) {
			if (error.code === 'ER_NO_SUCH_TABLE') {
				console.log(`⚠️  Table 'check_ins' does not exist, skipping...`);
				this.stats.checkIns.total = 0;
				console.log(`✅ Check-ins: 0 imported, 0 skipped, 0 errors\n`);
				return;
			}
			throw error;
		}

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.checkIns.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid) {
					this.stats.checkIns.skipped++;
					continue;
				}

				// Check for duplicate check-in (same owner and checkInTime)
				const checkInTime = record.checkInTime || record.createdAt || new Date();
				const existing = await this.checkInRepo!.findOne({
					where: {
						owner: { uid: ownerUid } as User,
						checkInTime: checkInTime,
					}
				});

				if (existing) {
					this.stats.checkIns.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate check-in: owner ${ownerUid}, checkInTime: ${checkInTime}`);
					continue;
				}

				const fullAddress = this.parseJSON(record.fullAddress, null);

				const newRecord = this.checkInRepo!.create({
					checkInTime: record.checkInTime || record.createdAt || new Date(),
					checkInPhoto: record.checkInPhoto || '',
					checkInLocation: record.checkInLocation || '',
					checkOutTime: record.checkOutTime || null,
					checkOutPhoto: record.checkOutPhoto || null,
					checkOutLocation: record.checkOutLocation || null,
					duration: record.duration || null,
					fullAddress,
					notes: record.notes || null,
					resolution: record.resolution || null,
					owner: { uid: ownerUid } as User,
					...(orgUid && { organisation: { uid: orgUid } as Organisation }),
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.checkInRepo!.save(newRecord);
				this.stats.checkIns.imported++;
			} catch (error: any) {
				this.stats.checkIns.errors++;
				if (this.verbose) console.error(`  ❌ Error importing check-in ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Check-ins: ${this.stats.checkIns.imported} imported, ${this.stats.checkIns.skipped} skipped, ${this.stats.checkIns.errors} errors\n`);
	}

	private async importLeads() {
		console.log('\n📦 Importing Leads...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM leads');
		const records = rows as any[];
		this.stats.leads.total = records.length;
		console.log(`Found ${records.length} leads`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.leads.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationUid || record.organisation_id, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid || !orgUid) {
					this.stats.leads.skipped++;
					continue;
				}

				// Check for duplicate lead (by email or name+companyName)
				let existing = null;
				if (record.email) {
					existing = await this.leadRepo!.findOne({
						where: {
							email: record.email,
							organisation: { uid: orgUid } as Organisation,
						}
					});
				}
				if (!existing && record.name && record.companyName) {
					existing = await this.leadRepo!.findOne({
						where: {
							name: record.name,
							companyName: record.companyName,
							organisation: { uid: orgUid } as Organisation,
						}
					});
				}

				if (existing) {
					this.leadMapping[record.uid] = existing.uid;
					this.stats.leads.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate lead: ${record.email || record.name} (${record.companyName})`);
					continue;
				}

				const scoringData = this.parseJSON(record.scoringData, null);
				const activityData = this.parseJSON(record.activityData, null);
				const bantQualification = this.parseJSON(record.bantQualification, null);
				const sourceTracking = this.parseJSON(record.sourceTracking, null);
				const competitorData = this.parseJSON(record.competitorData, null);
				const customFields = this.parseJSON(record.customFields, null);
				const changeHistory = this.parseJSON(record.changeHistory, []);
				const assignees = this.parseJSON(record.assignees, []).map((a: any) => ({
					uid: this.mapUid(a.uid || a, this.userMapping)
				})).filter((a: any) => a.uid);

				const newRecord = this.leadRepo!.create({
					name: record.name || null,
					companyName: record.companyName || null,
					email: record.email || null,
					phone: record.phone || null,
					category: record.category || 'OTHER',
					status: record.status || 'NEW',
					intent: record.intent || null,
					temperature: record.temperature || null,
					source: record.source || null,
					lifecycleStage: record.lifecycleStage || null,
					businessSize: record.businessSize || null,
					industry: record.industry || null,
					decisionMakerRole: record.decisionMakerRole || null,
					preferredCommunication: record.preferredCommunication || record.communicationPreference || null,
					priority: record.priority || null,
					budgetRange: record.budgetRange || null,
					purchaseTimeline: record.purchaseTimeline || record.timeline || null,
					notes: record.notes || null,
					scoringData,
					activityData,
					bantQualification,
					sourceTracking,
					competitorData,
					customFields,
					changeHistory,
					assignees,
					ownerUid,
					organisationUid: orgUid,
					branchUid: branchUid || null,
					owner: { uid: ownerUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				const saved: Lead = await this.leadRepo!.save(newRecord);
				this.leadMapping[record.uid] = saved.uid;
				this.stats.leads.imported++;
			} catch (error: any) {
				this.stats.leads.errors++;
				if (this.verbose) console.error(`  ❌ Error importing lead ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Leads: ${this.stats.leads.imported} imported, ${this.stats.leads.skipped} skipped, ${this.stats.leads.errors} errors\n`);
	}

	private async importQuotations() {
		console.log('\n📦 Importing Quotations...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM quotation');
		const records = rows as any[];
		this.stats.quotations.total = records.length;
		console.log(`Found ${records.length} quotations`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.quotations.imported++;
					continue;
				}

				const placedByUid = this.mapUid(record.placedBy || record.placedById || record.placedByUid, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);
				// Skip client mapping - clients excluded

				if (!placedByUid || !orgUid) {
					this.stats.quotations.skipped++;
					continue;
				}

				// Check for duplicate quotation (by quotationNumber or ref)
				const quotationNumber = record.quotationNumber || `QT-${Date.now()}-${record.uid}`;
				const existing = await this.quotationRepo!.findOne({
					where: {
						quotationNumber: quotationNumber,
						organisation: { uid: orgUid } as Organisation,
					}
				});

				if (existing) {
					this.quotationMapping[record.uid] = existing.uid;
					this.stats.quotations.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate quotation: ${quotationNumber}`);
					continue;
				}

				const newRecord = this.quotationRepo!.create({
					quotationNumber: quotationNumber,
					totalAmount: record.totalAmount || 0,
					totalItems: record.totalItems || 0,
					status: record.status || 'DRAFT',
					quotationDate: record.quotationDate || record.createdAt || new Date(),
					shippingMethod: record.shippingMethod || null,
					notes: record.notes || null,
					shippingInstructions: record.shippingInstructions || null,
					packagingRequirements: record.packagingRequirements || null,
					priceListType: record.priceListType || null,
					title: record.title || null,
					description: record.description || null,
					promoCode: record.promoCode || null,
					resellerCommission: record.resellerCommission || null,
					validUntil: record.validUntil || null,
					reviewToken: record.reviewToken || null,
					reviewUrl: record.reviewUrl || null,
					pdfURL: record.pdfURL || null,
					currency: record.currency || 'ZAR',
					placedBy: { uid: placedByUid } as User,
					...(orgUid && { organisation: { uid: orgUid } as Organisation }),
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				const saved = await this.quotationRepo!.save(newRecord);
				this.quotationMapping[record.uid] = saved.uid;
				this.stats.quotations.imported++;
			} catch (error: any) {
				this.stats.quotations.errors++;
				if (this.verbose) console.error(`  ❌ Error importing quotation ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Quotations: ${this.stats.quotations.imported} imported, ${this.stats.quotations.skipped} skipped, ${this.stats.quotations.errors} errors\n`);
	}

	private async importQuotationItems() {
		console.log('\n📦 Importing Quotation Items...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM quotation_item');
		const records = rows as any[];
		this.stats.quotationItems.total = records.length;
		console.log(`Found ${records.length} quotation items`);

		for (const record of records) {
			try {
				const quotationUid = this.mapUid(record.quotation || record.quotationId || record.quotation_id, this.quotationMapping);
				if (!quotationUid) {
					this.stats.quotationItems.skipped++;
					continue;
				}

				if (this.dryRun) {
					this.stats.quotationItems.imported++;
					continue;
				}

				// Skip product reference - products excluded
				const newRecord = this.quotationItemRepo!.create({
					quantity: record.quantity || 1,
					totalPrice: record.totalPrice || 0,
					unitPrice: record.unitPrice || 0,
					purchaseMode: record.purchaseMode || 'item',
					itemsPerUnit: record.itemsPerUnit || 1,
					notes: record.notes || null,
					quotation: { uid: quotationUid } as Quotation,
				});

				await this.quotationItemRepo!.save(newRecord);
				this.stats.quotationItems.imported++;
			} catch (error: any) {
				this.stats.quotationItems.errors++;
				if (this.verbose) console.error(`  ❌ Error importing quotation item ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Quotation Items: ${this.stats.quotationItems.imported} imported, ${this.stats.quotationItems.skipped} skipped, ${this.stats.quotationItems.errors} errors\n`);
	}

	private async importOrders() {
		console.log('\n📦 Importing Orders...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM `order`');
		const records = rows as any[];
		this.stats.orders.total = records.length;
		console.log(`Found ${records.length} orders`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.orders.imported++;
					continue;
				}

				const placedByUid = this.mapUid(record.placedBy || record.placedById || record.placedByUid, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);
				const quotationId = this.mapUid(record.quotationId || record.quotation_id, this.quotationMapping);

				if (!placedByUid || !orgUid) {
					this.stats.orders.skipped++;
					continue;
				}

				// Check for duplicate order (by orderNumber)
				const orderNumber = record.orderNumber || `ORD-${Date.now()}-${record.uid}`;
				const existing = await this.orderRepo!.findOne({
					where: {
						orderNumber: orderNumber,
						organisation: { uid: orgUid } as Organisation,
					}
				});

				if (existing) {
					this.orderMapping[record.uid] = existing.uid;
					this.stats.orders.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate order: ${orderNumber}`);
					continue;
				}

				const newRecord = this.orderRepo!.create({
					orderNumber: orderNumber,
					totalAmount: record.totalAmount || 0,
					totalItems: record.totalItems || 0,
					status: record.status || 'IN_FULFILLMENT',
					orderDate: record.orderDate || record.createdAt || new Date(),
					shippingMethod: record.shippingMethod || null,
					notes: record.notes || null,
					shippingInstructions: record.shippingInstructions || null,
					packagingRequirements: record.packagingRequirements || null,
					resellerCommission: record.resellerCommission || null,
					quotationId: quotationId || null,
					placedBy: { uid: placedByUid } as User,
					...(orgUid && { organisation: { uid: orgUid } as Organisation }),
					...(branchUid && { branch: { uid: branchUid } as Branch }),
					...(quotationId && { quotation: { uid: quotationId } as Quotation }),
				});

				const saved = await this.orderRepo!.save(newRecord);
				this.orderMapping[record.uid] = saved.uid;
				this.stats.orders.imported++;
			} catch (error: any) {
				this.stats.orders.errors++;
				if (this.verbose) console.error(`  ❌ Error importing order ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Orders: ${this.stats.orders.imported} imported, ${this.stats.orders.skipped} skipped, ${this.stats.orders.errors} errors\n`);
	}

	private async importOrderItems() {
		console.log('\n📦 Importing Order Items...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM order_item');
		const records = rows as any[];
		this.stats.orderItems.total = records.length;
		console.log(`Found ${records.length} order items`);

		for (const record of records) {
			try {
				const orderUid = this.mapUid(record.order || record.orderId || record.order_id, this.orderMapping);
				if (!orderUid) {
					this.stats.orderItems.skipped++;
					continue;
				}

				if (this.dryRun) {
					this.stats.orderItems.imported++;
					continue;
				}

				// Skip product reference - products excluded
				const newRecord = this.orderItemRepo!.create({
					quantity: record.quantity || 1,
					unitPrice: record.unitPrice || 0,
					totalPrice: record.totalPrice || 0,
					notes: record.notes || null,
					isShipped: record.isShipped || false,
					serialNumber: record.serialNumber || null,
					order: { uid: orderUid } as Order,
				});

				await this.orderItemRepo!.save(newRecord);
				this.stats.orderItems.imported++;
			} catch (error: any) {
				this.stats.orderItems.errors++;
				if (this.verbose) console.error(`  ❌ Error importing order item ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Order Items: ${this.stats.orderItems.imported} imported, ${this.stats.orderItems.skipped} skipped, ${this.stats.orderItems.errors} errors\n`);
	}

	// Batch import methods for remaining entities - simplified implementations
	// These follow the same pattern: read from MySQL, map foreign keys, create entities

	private async importTasks() {
		console.log('\n📦 Importing Tasks...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM tasks WHERE isDeleted = 0 OR isDeleted IS NULL');
		const records = rows as any[];
		this.stats.tasks.total = records.length;
		console.log(`Found ${records.length} tasks`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.tasks.imported++;
					continue;
				}

				const creatorUid = this.mapUid(record.creator || record.creatorUid || record.creator_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!creatorUid || !orgUid) {
					this.stats.tasks.skipped++;
					continue;
				}

				// Check for duplicate task (by title+creator+createdAt)
				let existing = null;
				if (record.title) {
					const createdAt = record.createdAt || new Date();
					existing = await this.taskRepo!.findOne({
						where: {
							title: record.title,
							creator: { uid: creatorUid } as User,
							organisation: { uid: orgUid } as Organisation,
						},
						order: { createdAt: 'DESC' }
					});
					
					// If found, check if createdAt is within 1 minute (likely duplicate)
					if (existing) {
						const recordTime = new Date(createdAt).getTime();
						const existingTime = new Date(existing.createdAt || 0).getTime();
						if (Math.abs(recordTime - existingTime) > 60000) {
							existing = null; // Not a duplicate if more than 1 minute apart
						}
					}
				}

				if (existing) {
					this.taskMapping[record.uid] = existing.uid;
					this.stats.tasks.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate task: ${record.title}`);
					continue;
				}

				const assignees = this.parseJSON(record.assignees, []).map((a: any) => ({
					uid: this.mapUid(a.uid || a, this.userMapping)
				})).filter((a: any) => a.uid);
				const clients = this.parseJSON(record.clients, []); // Skip client mapping
				const attachments = this.parseJSON(record.attachments, []);

				const newRecord = this.taskRepo!.create({
					title: record.title || '',
					description: record.description || '',
					status: record.status || 'PENDING',
					taskType: record.taskType || 'OTHER',
					priority: record.priority || 'MEDIUM',
					repetitionType: record.repetitionType || 'NONE',
					progress: record.progress || 0,
					deadline: record.deadline || null,
					repetitionDeadline: record.repetitionDeadline || null,
					completionDate: record.completionDate || null,
					isOverdue: record.isOverdue || false,
					targetCategory: record.targetCategory || null,
					attachments,
					jobStartTime: record.jobStartTime || null,
					jobEndTime: record.jobEndTime || null,
					jobDuration: record.jobDuration || null,
					jobStatus: record.jobStatus || 'QUEUED',
					assignees,
					clients,
					isDeleted: false,
					creator: { uid: creatorUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				const saved = await this.taskRepo!.save(newRecord);
				this.taskMapping[record.uid] = saved.uid;
				this.stats.tasks.imported++;
			} catch (error: any) {
				this.stats.tasks.errors++;
				if (this.verbose) console.error(`  ❌ Error importing task ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Tasks: ${this.stats.tasks.imported} imported, ${this.stats.tasks.skipped} skipped, ${this.stats.tasks.errors} errors\n`);
	}

	private async importSubtasks() {
		console.log('\n📦 Importing Subtasks...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM subtask');
		const records = rows as any[];
		this.stats.subtasks.total = records.length;
		console.log(`Found ${records.length} subtasks`);

		for (const record of records) {
			try {
				const taskUid = this.mapUid(record.task || record.taskId || record.task_id, this.taskMapping);
				if (!taskUid) {
					this.stats.subtasks.skipped++;
					continue;
				}

				if (this.dryRun) {
					this.stats.subtasks.imported++;
					continue;
				}

				const newRecord = this.subTaskRepo!.create({
					title: record.title || '',
					description: record.description || '',
					status: record.status || 'PENDING',
					isDeleted: false,
					task: { uid: taskUid } as Task,
				});

				await this.subTaskRepo!.save(newRecord);
				this.stats.subtasks.imported++;
			} catch (error: any) {
				this.stats.subtasks.errors++;
				if (this.verbose) console.error(`  ❌ Error importing subtask ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Subtasks: ${this.stats.subtasks.imported} imported, ${this.stats.subtasks.skipped} skipped, ${this.stats.subtasks.errors} errors\n`);
	}

	private async importInteractions() {
		console.log('\n📦 Importing Interactions...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM interactions');
		const records = rows as any[];
		this.stats.interactions.total = records.length;
		console.log(`Found ${records.length} interactions`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.interactions.imported++;
					continue;
				}

				const createdByUid = this.mapUid(record.createdBy || record.createdById, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);
				const leadUid = this.mapUid(record.lead || record.leadId || record.lead_id, this.leadMapping);
				const quotationUid = this.mapUid(record.quotation || record.quotationId, this.quotationMapping);

				if (!createdByUid || !orgUid) {
					this.stats.interactions.skipped++;
					continue;
				}

				const newRecord = this.interactionRepo!.create({
					message: record.message || '',
					attachmentUrl: record.attachmentUrl || null,
					type: record.type || 'MESSAGE',
					isDeleted: false,
					createdBy: { uid: createdByUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
					...(leadUid && { lead: { uid: leadUid } as Lead }),
					...(quotationUid && { quotation: { uid: quotationUid } as Quotation }),
				});

				await this.interactionRepo!.save(newRecord);
				this.stats.interactions.imported++;
			} catch (error: any) {
				this.stats.interactions.errors++;
				if (this.verbose) console.error(`  ❌ Error importing interaction ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Interactions: ${this.stats.interactions.imported} imported, ${this.stats.interactions.skipped} skipped, ${this.stats.interactions.errors} errors\n`);
	}

	private async importNotifications() {
		console.log('\n📦 Importing Notifications...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM notification');
		const records = rows as any[];
		this.stats.notifications.total = records.length;
		console.log(`Found ${records.length} notifications`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.notifications.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid || !orgUid) {
					this.stats.notifications.skipped++;
					continue;
				}

				const newRecord = this.notificationRepo!.create({
					type: record.type || 'USER',
					title: record.title || '',
					message: record.message || '',
					status: record.status || 'UNREAD',
					priority: record.priority || 'MEDIUM',
					owner: { uid: ownerUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.notificationRepo!.save(newRecord);
				this.stats.notifications.imported++;
			} catch (error: any) {
				this.stats.notifications.errors++;
				if (this.verbose) console.error(`  ❌ Error importing notification ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Notifications: ${this.stats.notifications.imported} imported, ${this.stats.notifications.skipped} skipped, ${this.stats.notifications.errors} errors\n`);
	}

	private async importJournals() {
		console.log('\n📦 Importing Journals...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM journal');
		const records = rows as any[];
		this.stats.journals.total = records.length;
		console.log(`Found ${records.length} journals`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.journals.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid || !orgUid) {
					this.stats.journals.skipped++;
					continue;
				}

				const attachments = this.parseJSON(record.attachments, []);
				const metadata = this.parseJSON(record.metadata, null);

				const newRecord = this.journalRepo!.create({
					title: record.title || null,
					description: record.description || record.content || null,
					type: record.type || 'GENERAL',
					status: record.status || 'PENDING_REVIEW',
					clientRef: record.clientRef || null,
					fileURL: record.fileURL || null,
					comments: record.comments || null,
					inspectionData: this.parseJSON(record.inspectionData, null),
					totalScore: record.totalScore || null,
					maxScore: record.maxScore || null,
					percentage: record.percentage || null,
					overallRating: record.overallRating || null,
					inspectorComments: record.inspectorComments || null,
					storeManagerSignature: record.storeManagerSignature || null,
					qcInspectorSignature: record.qcInspectorSignature || null,
					inspectionDate: record.inspectionDate || null,
					inspectionLocation: record.inspectionLocation || null,
					attachments,
					metadata,
					timestamp: record.timestamp || record.createdAt || new Date(),
					isDeleted: false,
					owner: { uid: ownerUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.journalRepo!.save(newRecord);
				this.stats.journals.imported++;
			} catch (error: any) {
				this.stats.journals.errors++;
				if (this.verbose) console.error(`  ❌ Error importing journal ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Journals: ${this.stats.journals.imported} imported, ${this.stats.journals.skipped} skipped, ${this.stats.journals.errors} errors\n`);
	}

	private async importReports() {
		console.log('\n📦 Importing Reports (large dataset - processing in batches)...');
		
		// First, get total count without ordering to avoid sort memory issues
		const [countRows] = await this.mysqlConnection!.execute('SELECT COUNT(*) as total FROM reports');
		const totalCount = Number((countRows as any[])[0]?.total || 0);
		this.stats.reports.total = totalCount;
		console.log(`Found ${totalCount} reports`);

		const batchSize = 500;
		let offset = 0;
		
		while (offset < totalCount) {
			// Fetch batch without ORDER BY to avoid sort memory issues
			// Note: MySQL2 doesn't support placeholders for LIMIT/OFFSET, so we use string interpolation
			const [rows] = await this.mysqlConnection!.execute(
				`SELECT * FROM reports LIMIT ${batchSize} OFFSET ${offset}`
			);
			const batch = rows as any[];
			
			if (batch.length === 0) break;
			
			const progress = `${Math.min(offset + batch.length, totalCount)}/${totalCount}`;
			process.stdout.write(`\r  Processing batch: ${progress}`);

			for (const record of batch) {
			try {
				if (this.dryRun) {
					this.stats.reports.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid || !orgUid) {
					this.stats.reports.skipped++;
					continue;
				}

					// Check for duplicates based on name, owner, and generatedAt
					const generatedAt = record.generatedAt || record.createdAt || new Date();
					const existing = await this.reportRepo!.findOne({
						where: {
							name: record.name || '',
							owner: { uid: ownerUid } as User,
						},
						order: { generatedAt: 'DESC' }
					});

					if (existing) {
						const recordTime = new Date(generatedAt).getTime();
						const existingTime = new Date(existing.generatedAt || 0).getTime();
						
						// If same name and within 1 minute, consider duplicate
						if (Math.abs(recordTime - existingTime) < 60000) {
							this.stats.reports.duplicates++;
							continue;
						}
						
						// Update if new report is newer
						if (recordTime > existingTime) {
							existing.description = record.description ?? existing.description;
							existing.reportData = this.parseJSON(record.reportData, existing.reportData);
							existing.filters = this.parseJSON(record.filters, existing.filters);
							existing.gpsData = this.parseJSON(record.gpsData, existing.gpsData);
							await this.reportRepo!.save(existing);
							this.stats.reports.updated++;
							continue;
						}
					}

				const filters = this.parseJSON(record.filters, {});
				const reportData = this.parseJSON(record.reportData, {});
				const gpsData = this.parseJSON(record.gpsData, null);

				const newRecord = this.reportRepo!.create({
					name: record.name || '',
					description: record.description || null,
					reportType: record.reportType || 'MAIN',
					filters,
						generatedAt,
					reportData,
					notes: record.notes || null,
					gpsData,
					totalDistanceKm: record.totalDistanceKm || null,
					totalStops: record.totalStops || null,
					owner: { uid: ownerUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				const savedReport = await this.reportRepo!.save(newRecord);
				// Build report mapping for linking to attendance records
				if (record.uid && savedReport.uid) {
					this.reportMapping[record.uid] = savedReport.uid;
				}
				this.stats.reports.imported++;
			} catch (error: any) {
				this.stats.reports.errors++;
					if (this.verbose && this.stats.reports.errors <= 10) {
						console.error(`\n  ❌ Error importing report ${record.uid}: ${error.message}`);
			}
		}
			}
			
			offset += batchSize;
		}
		console.log(`\n✅ Reports: ${this.stats.reports.imported} imported, ${this.stats.reports.skipped} skipped, ${this.stats.reports.duplicates} duplicates, ${this.stats.reports.updated} updated, ${this.stats.reports.errors} errors`);
	}

	private async importLeave() {
		console.log('\n📦 Importing Leave...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM `leave`');
		const records = rows as any[];
		this.stats.leave.total = records.length;
		console.log(`Found ${records.length} leave records`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.leave.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);
				const approvedByUid = this.mapUid(record.approvedBy || record.approvedById, this.userMapping);

				if (!ownerUid || !orgUid) {
					this.stats.leave.skipped++;
					continue;
				}

				// Check for duplicate leave (by owner, startDate, endDate)
				const startDate = record.startDate || new Date();
				const endDate = record.endDate || new Date();
				const existing = await this.leaveRepo!.findOne({
					where: {
						owner: { uid: ownerUid } as User,
						startDate: startDate,
						endDate: endDate,
					}
				});

				if (existing) {
					this.stats.leave.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate leave: owner ${ownerUid}, startDate: ${startDate}, endDate: ${endDate}`);
					continue;
				}

				const attachments = this.parseJSON(record.attachments, []);

				const newRecord = this.leaveRepo!.create({
					leaveType: record.leaveType || 'ANNUAL',
					startDate: startDate,
					endDate: endDate,
					duration: record.duration || 0,
					motivation: record.motivation || null,
					status: record.status || 'PENDING',
					comments: record.comments || null,
					isHalfDay: record.isHalfDay || false,
					halfDayPeriod: record.halfDayPeriod || null,
					attachments,
					approvedAt: record.approvedAt || null,
					rejectedAt: record.rejectedAt || null,
					rejectionReason: record.rejectionReason || null,
					owner: { uid: ownerUid } as User,
					...(approvedByUid && { approvedBy: { uid: approvedByUid } as User }),
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.leaveRepo!.save(newRecord);
				this.stats.leave.imported++;
			} catch (error: any) {
				this.stats.leave.errors++;
				if (this.verbose) console.error(`  ❌ Error importing leave ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Leave: ${this.stats.leave.imported} imported, ${this.stats.leave.skipped} skipped, ${this.stats.leave.errors} errors\n`);
	}

	private async importWarnings() {
		console.log('\n📦 Importing Warnings...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM warning');
		const records = rows as any[];
		this.stats.warnings.total = records.length;
		console.log(`Found ${records.length} warnings`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.warnings.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const issuedByUid = this.mapUid(record.issuedBy || record.issuedById, this.userMapping);

				if (!ownerUid || !issuedByUid) {
					this.stats.warnings.skipped++;
					continue;
				}

				// Check for duplicate warning (by owner, reason, expiresAt)
				const expiresAt = record.expiresAt || new Date();
				const existing = await this.warningRepo!.findOne({
					where: {
						owner: { uid: ownerUid } as User,
						reason: record.reason || '',
						expiresAt: expiresAt,
					}
				});

				if (existing) {
					this.stats.warnings.skipped++;
					if (this.verbose) console.log(`  ⏭️  Skipped duplicate warning: owner ${ownerUid}, reason: ${record.reason}`);
					continue;
				}

				const newRecord = this.warningRepo!.create({
					reason: record.reason || '',
					severity: record.severity || 'LOW',
					expiresAt: expiresAt,
					isExpired: record.isExpired || false,
					status: record.status || 'ACTIVE',
					owner: { uid: ownerUid } as User,
					issuedBy: { uid: issuedByUid } as User,
				});

				await this.warningRepo!.save(newRecord);
				this.stats.warnings.imported++;
			} catch (error: any) {
				this.stats.warnings.errors++;
				if (this.verbose) console.error(`  ❌ Error importing warning ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Warnings: ${this.stats.warnings.imported} imported, ${this.stats.warnings.skipped} skipped, ${this.stats.warnings.errors} errors\n`);
	}

	private async importTracking() {
		console.log('\n📦 Importing Tracking (all data - processing in batches)...');
		
		// Import ALL tracking records (no date filtering)
		// Use createdAt as primary ordering (standard field used throughout the code)
		// Also check timestamp field as fallback for records where createdAt might be NULL
		const query = `SELECT * FROM tracking 
			ORDER BY COALESCE(createdAt, FROM_UNIXTIME(timestamp / 1000)) ASC`;
		
		console.log(`📅 Importing all tracking records (no date filter)`);
		
		const [rows] = await this.mysqlConnection!.execute(query);
		const records = rows as any[];
		this.stats.tracking.total = records.length;
		console.log(`Found ${records.length} tracking records for the past 2 days to today`);

		const batchSize = 1000;
		for (let i = 0; i < records.length; i += batchSize) {
			const batch = records.slice(i, i + batchSize);
			const progress = `${Math.min(i + batchSize, records.length)}/${records.length}`;
			process.stdout.write(`\r  Processing batch: ${progress}`);

			for (const record of batch) {
			try {
				if (this.dryRun) {
					this.stats.tracking.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner_id || record.ownerUid || record.owner, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid || record.organisation_id, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid) {
					this.stats.tracking.skipped++;
					continue;
				}

					// Check for duplicates based on owner, lat, lng, and timestamp
					const existing = await this.trackingRepo!.findOne({
						where: {
							owner: { uid: ownerUid } as User,
							latitude: record.latitude || 0,
							longitude: record.longitude || 0,
						},
						order: { createdAt: 'DESC' }
					});

					if (existing && record.createdAt) {
						const recordTime = new Date(record.createdAt).getTime();
						const existingTime = new Date(existing.createdAt || 0).getTime();
						
						// If records are within 1 second and same location, consider duplicate
						if (Math.abs(recordTime - existingTime) < 1000) {
							this.stats.tracking.duplicates++;
							continue;
						}
						
						// Update if new record is newer
						if (recordTime > existingTime) {
							existing.address = this.preserveField(record.address) ?? existing.address;
							existing.notes = this.preserveField(record.notes) ?? existing.notes;
							existing.distance = this.preserveField(record.distance) ?? existing.distance;
							existing.duration = this.preserveField(record.duration) ?? existing.duration;
							existing.accuracy = this.preserveField(record.accuracy) ?? existing.accuracy;
							existing.altitude = this.preserveField(record.altitude) ?? existing.altitude;
							existing.altitudeAccuracy = this.preserveField(record.altitudeAccuracy) ?? existing.altitudeAccuracy;
							existing.heading = this.preserveField(record.heading) ?? existing.heading;
							existing.speed = this.preserveField(record.speed) ?? existing.speed;
							existing.timestamp = this.preserveField(record.timestamp) ?? existing.timestamp;
							existing.batteryLevel = this.preserveField(record.batteryLevel) ?? existing.batteryLevel;
							existing.batteryState = this.preserveField(record.batteryState) ?? existing.batteryState;
							existing.brand = this.preserveField(record.brand) ?? existing.brand;
							existing.manufacturer = this.preserveField(record.manufacturer) ?? existing.manufacturer;
							existing.modelID = this.preserveField(record.modelID) ?? existing.modelID;
							existing.modelName = this.preserveField(record.modelName) ?? existing.modelName;
							existing.osName = this.preserveField(record.osName) ?? existing.osName;
							existing.osVersion = this.preserveField(record.osVersion) ?? existing.osVersion;
							existing.network = this.parseJSON(record.network, existing.network);
							existing.addressDecodingError = this.preserveField(record.addressDecodingError) ?? existing.addressDecodingError;
							existing.rawLocation = this.preserveField(record.rawLocation) ?? existing.rawLocation;
							existing.metadata = this.parseJSON(record.metadata, existing.metadata);
							existing.updatedAt = this.preserveField(record.updatedAt) || new Date();
							existing.deletedAt = this.preserveField(record.deletedAt);
							existing.deletedBy = this.preserveField(record.deletedBy);
							if (orgUid) existing.organisation = { uid: orgUid } as Organisation;
							if (branchUid) existing.branch = { uid: branchUid } as Branch;
							await this.trackingRepo!.save(existing);
							this.stats.tracking.updated++;
							continue;
						}
					}

				// Parse JSON fields
				const network = this.parseJSON(record.network, null);
				const metadata = this.parseJSON(record.metadata, null);

				const trackingData: DeepPartial<any> = {
					latitude: record.latitude || 0,
					longitude: record.longitude || 0,
					address: this.preserveField(record.address),
					notes: this.preserveField(record.notes),
					distance: this.preserveField(record.distance),
					duration: this.preserveField(record.duration),
					accuracy: this.preserveField(record.accuracy),
					altitude: this.preserveField(record.altitude),
					altitudeAccuracy: this.preserveField(record.altitudeAccuracy),
					heading: this.preserveField(record.heading),
					speed: this.preserveField(record.speed),
					timestamp: this.preserveField(record.timestamp),
					batteryLevel: this.preserveField(record.batteryLevel),
					batteryState: this.preserveField(record.batteryState),
					brand: this.preserveField(record.brand),
					manufacturer: this.preserveField(record.manufacturer),
					modelID: this.preserveField(record.modelID),
					modelName: this.preserveField(record.modelName),
					osName: this.preserveField(record.osName),
					osVersion: this.preserveField(record.osVersion),
					network, // Already parsed JSON
					addressDecodingError: this.preserveField(record.addressDecodingError),
					rawLocation: this.preserveField(record.rawLocation),
					metadata, // Already parsed JSON
					createdAt: this.preserveField(record.createdAt) || new Date(),
					updatedAt: this.preserveField(record.updatedAt) || new Date(),
					deletedAt: this.preserveField(record.deletedAt),
					deletedBy: this.preserveField(record.deletedBy),
					owner: { uid: ownerUid } as User,
				};

				if (orgUid) {
					trackingData.organisation = { uid: orgUid } as Organisation;
				}
				if (branchUid) {
					trackingData.branch = { uid: branchUid } as Branch;
				}

				const newRecord = this.trackingRepo!.create(trackingData);

				await this.trackingRepo!.save(newRecord);
				this.stats.tracking.imported++;
			} catch (error: any) {
				this.stats.tracking.errors++;
					if (this.verbose && this.stats.tracking.errors <= 10) {
						console.error(`\n  ❌ Error importing tracking ${record.uid}: ${error.message}`);
			}
		}
			}
		}
		console.log(`\n✅ Tracking: ${this.stats.tracking.imported} imported, ${this.stats.tracking.skipped} skipped, ${this.stats.tracking.duplicates} duplicates, ${this.stats.tracking.updated} updated, ${this.stats.tracking.errors} errors`);
	}

	private async importDocs() {
		console.log('\n📦 Importing Docs...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM docs WHERE isActive = 1 OR isActive IS NULL');
		const records = rows as any[];
		this.stats.docs.total = records.length;
		console.log(`Found ${records.length} docs`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.docs.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid || record.owner_id, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid || !orgUid) {
					this.stats.docs.skipped++;
					continue;
				}

				const metadata = this.parseJSON(record.metadata, null);
				const sharedWith = record.sharedWith ? (typeof record.sharedWith === 'string' ? record.sharedWith.split(',') : record.sharedWith) : [];

				const newRecord = this.docRepo!.create({
					title: record.title || '',
					content: record.content || '',
					description: record.description || null,
					fileType: record.fileType || '',
					docType: record.docType || null,
					fileSize: record.fileSize || 0,
					url: record.url || '',
					metadata,
					isActive: record.isActive !== undefined ? record.isActive : true,
					mimeType: record.mimeType || null,
					extension: record.extension || null,
					sharedWith,
					isPublic: record.isPublic || false,
					lastAccessedAt: record.lastAccessedAt || null,
					owner: { uid: ownerUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.docRepo!.save(newRecord);
				this.stats.docs.imported++;
			} catch (error: any) {
				this.stats.docs.errors++;
				if (this.verbose) console.error(`  ❌ Error importing doc ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Docs: ${this.stats.docs.imported} imported, ${this.stats.docs.skipped} skipped, ${this.stats.docs.errors} errors\n`);
	}

	// Simplified imports for remaining entities - following same pattern
	private async importAssets() {
		console.log('\n📦 Importing Assets...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM asset');
		const records = rows as any[];
		this.stats.assets.total = records.length;
		console.log(`Found ${records.length} assets`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.assets.imported++;
					continue;
				}

				const ownerUid = this.mapUid(record.owner || record.ownerUid, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!ownerUid || !orgUid) {
					this.stats.assets.skipped++;
					continue;
				}

				const newRecord = this.assetRepo!.create({
					brand: record.brand || record.name || '',
					serialNumber: record.serialNumber || '',
					modelNumber: record.modelNumber || '',
					purchaseDate: record.purchaseDate || new Date(),
					hasInsurance: record.hasInsurance !== undefined ? record.hasInsurance : false,
					insuranceProvider: record.insuranceProvider || '',
					insuranceExpiryDate: record.insuranceExpiryDate || new Date(),
					isDeleted: false,
					owner: { uid: ownerUid } as User,
					org: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.assetRepo!.save(newRecord);
				this.stats.assets.imported++;
			} catch (error: any) {
				this.stats.assets.errors++;
				if (this.verbose) console.error(`  ❌ Error importing asset ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Assets: ${this.stats.assets.imported} imported, ${this.stats.assets.skipped} skipped, ${this.stats.assets.errors} errors\n`);
	}

	private async importNews() {
		console.log('\n📦 Importing News...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM news');
		const records = rows as any[];
		this.stats.news.total = records.length;
		console.log(`Found ${records.length} news items`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.news.imported++;
					continue;
				}

				const authorUid = this.mapUid(record.author || record.authorUid, this.userMapping);
				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!authorUid || !orgUid) {
					this.stats.news.skipped++;
					continue;
				}

				const newRecord = this.newsRepo!.create({
					title: record.title || '',
					subtitle: record.subtitle || '',
					content: record.content || '',
					attachments: record.attachments || '',
					coverImage: record.coverImage || record.imageUrl || '',
					thumbnail: record.thumbnail || record.imageUrl || '',
					publishingDate: record.publishingDate || record.publishedAt || record.createdAt || new Date(),
					status: record.status || 'ACTIVE',
					category: record.category || null,
					shareLink: record.shareLink || null,
					isDeleted: false,
					author: { uid: authorUid } as User,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.newsRepo!.save(newRecord);
				this.stats.news.imported++;
			} catch (error: any) {
				this.stats.news.errors++;
				if (this.verbose) console.error(`  ❌ Error importing news ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ News: ${this.stats.news.imported} imported, ${this.stats.news.skipped} skipped, ${this.stats.news.errors} errors\n`);
	}

	private async importFeedback() {
		console.log('\n📦 Importing Feedback...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM feedback');
		const records = rows as any[];
		this.stats.feedback.total = records.length;
		console.log(`Found ${records.length} feedback items`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.feedback.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisation_uid || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branch_uid || record.branchUid, this.branchMapping);
				const taskUid = this.mapUid(record.task_uid || record.taskUid, this.taskMapping);

				const attachments = record.attachments ? (typeof record.attachments === 'string' ? record.attachments.split(',') : record.attachments) : [];

				const newRecord = this.feedbackRepo!.create({
					type: record.type || 'GENERAL',
					title: record.title || '',
					comments: record.comments || record.comment || '',
					attachments,
					rating: record.rating || null,
					status: record.status || 'NEW',
					token: record.token || null,
					responseText: record.responseText || null,
					respondedBy: record.respondedBy || null,
					respondedAt: record.respondedAt || null,
					isDeleted: false,
					...(orgUid && { organisation: { uid: orgUid } as Organisation }),
					...(branchUid && { branch: { uid: branchUid } as Branch }),
					...(taskUid && { task: { uid: taskUid } as Task }),
				});

				await this.feedbackRepo!.save(newRecord);
				this.stats.feedback.imported++;
			} catch (error: any) {
				this.stats.feedback.errors++;
				if (this.verbose) console.error(`  ❌ Error importing feedback ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Feedback: ${this.stats.feedback.imported} imported, ${this.stats.feedback.skipped} skipped, ${this.stats.feedback.errors} errors\n`);
	}

	private async importCompetitors() {
		console.log('\n📦 Importing Competitors...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM competitor');
		const records = rows as any[];
		this.stats.competitors.total = records.length;
		console.log(`Found ${records.length} competitors`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.competitors.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				if (!orgUid) {
					this.stats.competitors.skipped++;
					continue;
				}

				const address = this.parseJSON(record.address, {
					street: '', suburb: '', city: '', state: '', country: '', postalCode: ''
				});
				const keyProducts = record.keyProducts ? (typeof record.keyProducts === 'string' ? record.keyProducts.split(',') : record.keyProducts) : [];
				const keyStrengths = record.keyStrengths || record.strengths ? (typeof (record.keyStrengths || record.strengths) === 'string' ? (record.keyStrengths || record.strengths).split(',') : (record.keyStrengths || record.strengths)) : [];
				const keyWeaknesses = record.keyWeaknesses || record.weaknesses ? (typeof (record.keyWeaknesses || record.weaknesses) === 'string' ? (record.keyWeaknesses || record.weaknesses).split(',') : (record.keyWeaknesses || record.weaknesses)) : [];
				const pricingData = this.parseJSON(record.pricingData, null);
				const socialMedia = this.parseJSON(record.socialMedia, null);
				const owners = this.parseJSON(record.owners, null);
				const managers = this.parseJSON(record.managers, null);
				const purchaseManagers = this.parseJSON(record.purchaseManagers, null);
				const accountManagers = this.parseJSON(record.accountManagers, null);
				const franchiseHoneyPot = this.parseJSON(record.franchiseHoneyPot, null);

				const newRecord = this.competitorRepo!.create({
					name: record.name || '',
					description: record.description || null,
					website: record.website || null,
					landingPage: record.landingPage || null,
					contactEmail: record.contactEmail || null,
					contactPhone: record.contactPhone || null,
					address,
					alias: record.alias || null,
					latitude: record.latitude || null,
					longitude: record.longitude || null,
					logoUrl: record.logoUrl || null,
					status: record.status || 'ACTIVE',
					marketSharePercentage: record.marketSharePercentage || record.marketShare || null,
					estimatedAnnualRevenue: record.estimatedAnnualRevenue || null,
					industry: record.industry || null,
					keyProducts,
					keyStrengths,
					keyWeaknesses,
					estimatedEmployeeCount: record.estimatedEmployeeCount || null,
					threatLevel: record.threatLevel || 0,
					competitiveAdvantage: record.competitiveAdvantage || 0,
					pricingData,
					businessStrategy: record.businessStrategy || null,
					marketingStrategy: record.marketingStrategy || null,
					isDirect: record.isDirect || false,
					foundedDate: record.foundedDate || null,
					socialMedia,
					isDeleted: false,
					competitorRef: record.competitorRef || null,
					geofenceType: record.geofenceType || 'NONE',
					geofenceRadius: record.geofenceRadius || 500,
					enableGeofence: record.enableGeofence || false,
					accountName: record.accountName || null,
					BDM: record.BDM || null,
					LegalEntity: record.LegalEntity || null,
					TradingName: record.TradingName || null,
					MemberLevel: record.MemberLevel || null,
					MemberShips: record.MemberShips || null,
					brandStatus: record.brandStatus || null,
					bank: record.bank || null,
					owners,
					managers,
					purchaseManagers,
					accountManagers,
					companyRegNumber: record.companyRegNumber || null,
					vatNumber: record.vatNumber || null,
					CRO: record.CRO || null,
					franchiseEmail: record.franchiseEmail || null,
					franchisePhone: record.franchisePhone || null,
					franchiseHoneyPot,
					onlineVisibilityMKTG: record.onlineVisibilityMKTG || 0,
					onlineVisibilitySEO: record.onlineVisibilitySEO || 0,
					onlineVisibilitySocial: record.onlineVisibilitySocial || 0,
					hasLoyaltyProgram: record.hasLoyaltyProgram || false,
					hasRewardsProgram: record.hasRewardsProgram || false,
					hasReferralProgram: record.hasReferralProgram || false,
					organisation: { uid: orgUid } as Organisation,
				});

				await this.competitorRepo!.save(newRecord);
				this.stats.competitors.imported++;
			} catch (error: any) {
				this.stats.competitors.errors++;
				if (this.verbose) console.error(`  ❌ Error importing competitor ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Competitors: ${this.stats.competitors.imported} imported, ${this.stats.competitors.skipped} skipped, ${this.stats.competitors.errors} errors\n`);
	}

	private async importResellers() {
		console.log('\n📦 Importing Resellers...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM reseller');
		const records = rows as any[];
		this.stats.resellers.total = records.length;
		console.log(`Found ${records.length} resellers`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.resellers.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);
				if (!orgUid) {
					this.stats.resellers.skipped++;
					continue;
				}

				const address = this.parseJSON(record.address, {
					street: '', city: '', state: '', country: '', postalCode: ''
				});

				const newRecord = this.resellerRepo!.create({
					name: record.name || '',
					description: record.description || '',
					logo: record.logo || '',
					website: record.website || '',
					status: record.status || 'ACTIVE',
					contactPerson: record.contactPerson || '',
					phone: record.phone || '',
					email: record.email || '',
					address,
					isDeleted: false,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.resellerRepo!.save(newRecord);
				this.stats.resellers.imported++;
			} catch (error: any) {
				this.stats.resellers.errors++;
				if (this.verbose) console.error(`  ❌ Error importing reseller ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Resellers: ${this.stats.resellers.imported} imported, ${this.stats.resellers.skipped} skipped, ${this.stats.resellers.errors} errors\n`);
	}

	private async importBanners() {
		console.log('\n📦 Importing Banners...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM banners');
		const records = rows as any[];
		this.stats.banners.total = records.length;
		console.log(`Found ${records.length} banners`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.banners.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);
				if (!orgUid) {
					this.stats.banners.skipped++;
					continue;
				}

				const newRecord = this.bannersRepo!.create({
					title: record.title || '',
					subtitle: record.subtitle || '',
					description: record.description || '',
					image: record.image || record.imageUrl || '',
					category: record.category || 'NEWS',
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				await this.bannersRepo!.save(newRecord);
				this.stats.banners.imported++;
			} catch (error: any) {
				this.stats.banners.errors++;
				if (this.verbose) console.error(`  ❌ Error importing banner ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Banners: ${this.stats.banners.imported} imported, ${this.stats.banners.skipped} skipped, ${this.stats.banners.errors} errors\n`);
	}

	private async importProjects() {
		console.log('\n📦 Importing Projects...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM project WHERE isDeleted = 0 OR isDeleted IS NULL');
		const records = rows as any[];
		this.stats.projects.total = records.length;
		console.log(`Found ${records.length} projects`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.projects.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisationRef || record.organisationUid, this.orgMapping);
				const branchUid = this.mapUid(record.branchUid || record.branch_id, this.branchMapping);

				if (!orgUid) {
					this.stats.projects.skipped++;
					continue;
				}

				const newRecord = this.projectRepo!.create({
					name: record.name || '',
					description: record.description || null,
					status: record.status || 'ACTIVE',
					startDate: record.startDate || null,
					endDate: record.endDate || null,
					budget: record.budget || null,
					organisation: { uid: orgUid } as Organisation,
					...(branchUid && { branch: { uid: branchUid } as Branch }),
				});

				const saved = await this.projectRepo!.save(newRecord);
				this.projectMapping[record.uid] = saved.uid;
				this.stats.projects.imported++;
			} catch (error: any) {
				this.stats.projects.errors++;
				if (this.verbose) console.error(`  ❌ Error importing project ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Projects: ${this.stats.projects.imported} imported, ${this.stats.projects.skipped} skipped, ${this.stats.projects.errors} errors\n`);
	}

	private async importOrganisationSettings() {
		console.log('\n📦 Importing Organisation Settings...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM organisation_settings');
		const records = rows as any[];
		this.stats.orgSettings.total = records.length;
		console.log(`Found ${records.length} organisation settings`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.orgSettings.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisationUid || record.organisation_id, this.orgMapping);
				if (!orgUid) {
					this.stats.orgSettings.skipped++;
					continue;
				}

				const contact = this.parseJSON(record.contact, null);
				const regional = this.parseJSON(record.regional, null);
				const branding = this.parseJSON(record.branding, null);
				const business = this.parseJSON(record.business, null);
				const notifications = this.parseJSON(record.notifications, null);
				const preferences = this.parseJSON(record.preferences, null);
				const socialLinks = this.parseJSON(record.socialLinks, null);
				const performance = this.parseJSON(record.performance, null);

				const newRecord = this.orgSettingsRepo!.create({
					contact,
					regional,
					branding,
					business,
					notifications,
					preferences,
					geofenceDefaultRadius: record.geofenceDefaultRadius || 500,
					geofenceEnabledByDefault: record.geofenceEnabledByDefault || false,
					geofenceDefaultNotificationType: record.geofenceDefaultNotificationType || 'NOTIFY',
					geofenceMaxRadius: record.geofenceMaxRadius || 5000,
					geofenceMinRadius: record.geofenceMinRadius || 100,
					isDeleted: false,
					sendTaskNotifications: record.sendTaskNotifications || false,
					feedbackTokenExpiryDays: record.feedbackTokenExpiryDays || 30,
					socialLinks,
					performance,
					organisationUid: orgUid,
					organisation: { uid: orgUid } as Organisation,
				});

				await this.orgSettingsRepo!.save(newRecord);
				this.stats.orgSettings.imported++;
			} catch (error: any) {
				this.stats.orgSettings.errors++;
				if (this.verbose) console.error(`  ❌ Error importing org settings ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Organisation Settings: ${this.stats.orgSettings.imported} imported, ${this.stats.orgSettings.skipped} skipped, ${this.stats.orgSettings.errors} errors\n`);
	}

	private async importOrganisationAppearance() {
		console.log('\n📦 Importing Organisation Appearance...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM organisation_appearance');
		const records = rows as any[];
		this.stats.orgAppearance.total = records.length;
		console.log(`Found ${records.length} organisation appearance records`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.orgAppearance.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisationUid || record.organisation_id, this.orgMapping);
				if (!orgUid) {
					this.stats.orgAppearance.skipped++;
					continue;
				}

				const newRecord = this.orgAppearanceRepo!.create({
					ref: record.ref || `ORG-${orgUid}`,
					primaryColor: record.primaryColor || null,
					secondaryColor: record.secondaryColor || null,
					accentColor: record.accentColor || null,
					errorColor: record.errorColor || null,
					successColor: record.successColor || null,
					logoUrl: record.logoUrl || null,
					logoAltText: record.logoAltText || null,
					isDeleted: false,
					organisationUid: orgUid,
					organisation: { uid: orgUid } as Organisation,
				});

				await this.orgAppearanceRepo!.save(newRecord);
				this.stats.orgAppearance.imported++;
			} catch (error: any) {
				this.stats.orgAppearance.errors++;
				if (this.verbose) console.error(`  ❌ Error importing org appearance ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Organisation Appearance: ${this.stats.orgAppearance.imported} imported, ${this.stats.orgAppearance.skipped} skipped, ${this.stats.orgAppearance.errors} errors\n`);
	}

	private async importOrganisationHours() {
		console.log('\n📦 Importing Organisation Hours...');
		const [rows] = await this.mysqlConnection!.execute('SELECT * FROM organisation_hours');
		const records = rows as any[];
		this.stats.orgHours.total = records.length;
		console.log(`Found ${records.length} organisation hours`);

		for (const record of records) {
			try {
				if (this.dryRun) {
					this.stats.orgHours.imported++;
					continue;
				}

				const orgUid = this.mapUid(record.organisationUid || record.organisation_id, this.orgMapping);
				if (!orgUid) {
					this.stats.orgHours.skipped++;
					continue;
				}

				const weeklySchedule = this.parseJSON(record.weeklySchedule, {
					monday: true, tuesday: true, wednesday: true, thursday: true,
					friday: true, saturday: false, sunday: false
				});
				const schedule = this.parseJSON(record.schedule, null);
				const specialHours = this.parseJSON(record.specialHours, null);

				const newRecord = this.orgHoursRepo!.create({
					ref: record.ref || `ORG-${orgUid}`,
					openTime: record.openTime || '09:00:00',
					closeTime: record.closeTime || '17:00:00',
					weeklySchedule,
					schedule,
					timezone: record.timezone || null,
					holidayMode: record.holidayMode || false,
					holidayUntil: record.holidayUntil || null,
					specialHours,
					isDeleted: false,
					organisationUid: orgUid,
					organisation: { uid: orgUid } as Organisation,
				});

				await this.orgHoursRepo!.save(newRecord);
				this.stats.orgHours.imported++;
			} catch (error: any) {
				this.stats.orgHours.errors++;
				if (this.verbose) console.error(`  ❌ Error importing org hours ${record.uid}: ${error.message}`);
			}
		}
		console.log(`✅ Organisation Hours: ${this.stats.orgHours.imported} imported, ${this.stats.orgHours.skipped} skipped, ${this.stats.orgHours.errors} errors\n`);
	}

	private printStats(duration: string) {
		console.log('\n' + '='.repeat(60));
		console.log('📊 MIGRATION SUMMARY');
		console.log('='.repeat(60));
		console.log(`⏱️  Duration: ${duration}s\n`);
		
		const printEntityStats = (name: string, stats: any) => {
			console.log(`${name}:`);
			console.log(`  Total: ${stats.total}, Imported: ${stats.imported}, Skipped: ${stats.skipped}, Duplicates: ${stats.duplicates || 0}, Updated: ${stats.updated || 0}, Errors: ${stats.errors}`);
		};
		
		printEntityStats('Organisations', this.stats.organisations);
		
		printEntityStats('Branches', this.stats.branches);
		printEntityStats('Users', this.stats.users);
		printEntityStats('User Profiles', this.stats.userProfiles);
		printEntityStats('User Employment Profiles', this.stats.userEmploymentProfiles);
		printEntityStats('User Targets', this.stats.userTargets);
		printEntityStats('User Rewards', this.stats.userRewards);
		
		printEntityStats('Devices', this.stats.devices);
		printEntityStats('Device Records', this.stats.deviceRecords);
		printEntityStats('Licenses', this.stats.licenses);
		printEntityStats('Attendance', this.stats.attendance);
		printEntityStats('Claims', this.stats.claims);
		printEntityStats('Check-ins', this.stats.checkIns);
		printEntityStats('Leads', this.stats.leads);
		printEntityStats('Quotations', this.stats.quotations);
		printEntityStats('Quotation Items', this.stats.quotationItems);
		printEntityStats('Orders', this.stats.orders);
		printEntityStats('Order Items', this.stats.orderItems);
		printEntityStats('Tasks', this.stats.tasks);
		printEntityStats('Subtasks', this.stats.subtasks);
		printEntityStats('Interactions', this.stats.interactions);
		printEntityStats('Notifications', this.stats.notifications);
		printEntityStats('Journals', this.stats.journals);
		printEntityStats('Reports', this.stats.reports);
		printEntityStats('Leave', this.stats.leave);
		printEntityStats('Warnings', this.stats.warnings);
		printEntityStats('Tracking', this.stats.tracking);
		printEntityStats('Docs', this.stats.docs);
		printEntityStats('Assets', this.stats.assets);
		printEntityStats('News', this.stats.news);
		printEntityStats('Feedback', this.stats.feedback);
		printEntityStats('Competitors', this.stats.competitors);
		printEntityStats('Resellers', this.stats.resellers);
		printEntityStats('Banners', this.stats.banners);
		printEntityStats('Projects', this.stats.projects);
		printEntityStats('Organisation Settings', this.stats.orgSettings);
		printEntityStats('Organisation Appearance', this.stats.orgAppearance);
		printEntityStats('Organisation Hours', this.stats.orgHours);
		
		console.log('\n' + '='.repeat(60));
	}

	async cleanup() {
		console.log('\n🧹 Cleaning up connections...');
		
		if (this.mysqlConnection) {
			await this.mysqlConnection.end();
			console.log('✅ MySQL connection closed');
		}
		
		// Clean up source PostgreSQL DataSource if initialized
		if (this.pgSourceDataSource && this.pgSourceDataSource.isInitialized) {
			try {
				await this.pgSourceDataSource.destroy();
				console.log('✅ Source PostgreSQL connection closed');
			} catch (error: any) {
				console.warn('⚠️  Warning during source DataSource cleanup:', error.message);
			}
		}
		
		// Destroy custom DataSource first if we created one (pgUrl override)
		// Check if we have a custom DataSource by seeing if pgUrl was provided
		const hasCustomDataSource = process.argv.some(arg => arg.includes('--pg-url'));
		if (hasCustomDataSource && this.pgDataSource && this.pgDataSource.isInitialized) {
			try {
				await this.pgDataSource.destroy();
				console.log('✅ Custom PostgreSQL connection closed');
			} catch (error: any) {
				// Ignore cleanup errors
				console.warn('⚠️  Warning during custom DataSource cleanup:', error.message);
			}
		}
		
		// Close NestJS app last - it will handle its own DataSource cleanup
		if (this.app) {
			try {
				await this.app.close();
				console.log('✅ NestJS app closed');
			} catch (error: any) {
				// Ignore cleanup errors - they're not critical
				// This often happens when DataSource is already destroyed
				if (!error.message?.includes('DataSource')) {
					console.warn('⚠️  Warning during app cleanup:', error.message);
				}
			}
		}
	}
}

async function main() {
	const argv = yargs(hideBin(process.argv))
		.options({
			'pg-url': {
				type: 'string',
				describe: 'PostgreSQL connection URL (postgresql://user:pass@host:port/dbname) - target database',
			},
			step: {
				type: 'string',
				choices: ['mysql-to-local', 'local-to-remote'],
				describe: 'Migration step: mysql-to-local (MySQL to local PostgreSQL) or local-to-remote (local PostgreSQL to remote PostgreSQL)',
			},
			'dry-run': {
				type: 'boolean',
				default: false,
				describe: 'Preview migration without writing data',
			},
			only: {
				type: 'string',
				describe: 'Import only specific entities (comma-separated: orgs,branches,users,usertargets,devices,licenses)',
			},
			verbose: {
				type: 'boolean',
				default: false,
				describe: 'Show detailed progress',
			},
		})
		.help()
		.parseSync() as ScriptArguments;

	const migrator = new LegacyDbMigrator();

	try {
		await migrator.initialize(argv.step, argv['pg-url']);
		await migrator.migrate(argv);
	} catch (error) {
		console.error('\n❌ Migration failed:', error);
		process.exit(1);
	} finally {
		await migrator.cleanup();
	}
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});

