import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { User } from './user/entities/user.entity';
import { CommunicationModule } from './communication/communication.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { UserProfile } from './user/entities/user.profile.entity';
import { UserEmployeementProfile } from './user/entities/user.employeement.profile.entity';
import { AttendanceModule } from './attendance/attendance.module';
import { Attendance } from './attendance/entities/attendance.entity';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TrackingModule } from './tracking/tracking.module';
import { DocsModule } from './docs/docs.module';
import { ClaimsModule } from './claims/claims.module';
import { Claim } from './claims/entities/claim.entity';
import { Doc } from './docs/entities/doc.entity';
import { LeadsModule } from './leads/leads.module';
import { Lead } from './leads/entities/lead.entity';
import { JournalModule } from './journal/journal.module';
import { Journal } from './journal/entities/journal.entity';
import { TasksModule } from './tasks/tasks.module';
import { Task } from './tasks/entities/task.entity';
import { SubTask } from './tasks/entities/subtask.entity';
import { Route } from './tasks/entities/route.entity';
import { TaskFlag } from './tasks/entities/task-flag.entity';
import { TaskFlagItem } from './tasks/entities/task-flag-item.entity';
import { OrganisationModule } from './organisation/organisation.module';
import { BranchModule } from './branch/branch.module';
import { Branch } from './branch/entities/branch.entity';
import { Organisation } from './organisation/entities/organisation.entity';
import { NewsModule } from './news/news.module';
import { News } from './news/entities/news.entity';
import { AssetsModule } from './assets/assets.module';
import { Asset } from './assets/entities/asset.entity';
import { Tracking } from './tracking/entities/tracking.entity';
import { ShopModule } from './shop/shop.module';
import { ResellersModule } from './resellers/resellers.module';
import { Quotation } from './shop/entities/quotation.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { Notification } from './notifications/entities/notification.entity';
import { ClientsModule } from './clients/clients.module';
import { Client } from './clients/entities/client.entity';
import { ProductsModule } from './products/products.module';
import { Product } from './products/entities/product.entity';
import { Reseller } from './resellers/entities/reseller.entity';
import { ReportsModule } from './reports/reports.module';
import { QuotationItem } from './shop/entities/quotation-item.entity';
import { Banners } from './shop/entities/banners.entity';
import { CommunicationLog } from './communication/entities/communication-log.entity';
import { CheckInsModule } from './check-ins/check-ins.module';
import { CheckIn } from './check-ins/entities/check-in.entity';
import { RewardsModule } from './rewards/rewards.module';
import { UserRewards } from './rewards/entities/user-rewards.entity';
import { Achievement } from './rewards/entities/achievement.entity';
import { UnlockedItem } from './rewards/entities/unlocked-item.entity';
import { XPTransaction } from './rewards/entities/xp-transaction.entity';
import { CacheModule } from '@nestjs/cache-manager';
import { Report } from './reports/entities/report.entity';
import { PendingSignup } from './auth/entities/pending-signup.entity';
import { PasswordReset } from './auth/entities/password-reset.entity';
import { License } from './licensing/entities/license.entity';
import { LicenseUsage } from './licensing/entities/license-usage.entity';
import { LicenseEvent } from './licensing/entities/license-event.entity';
import { LicensingModule } from './licensing/licensing.module';
import { LicenseUsageInterceptor } from './licensing/license-usage.interceptor';
import { OrganisationSettings } from './organisation/entities/organisation-settings.entity';
import { OrganisationAppearance } from './organisation/entities/organisation-appearance.entity';
import { OrganisationHours } from './organisation/entities/organisation-hours.entity';
import { ProductAnalytics } from './products/entities/product-analytics.entity';
import { FeedbackModule } from './feedback/feedback.module';
import { Feedback } from './feedback/entities/feedback.entity';
import { CompetitorsModule } from './competitors/competitors.module';
import { Competitor } from './competitors/entities/competitor.entity';
import { Geofence } from './tracking/entities/geofence.entity';
import { GeofenceEvent } from './tracking/entities/geofence-event.entity';
import { Reward } from './rewards/entities/reward.entity';
import { Order } from './shop/entities/order.entity';
import { OrderItem } from './shop/entities/order-item.entity';
import { ClientAuth } from './clients/entities/client.auth.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { LibModule } from './lib/lib.module';
import { InteractionsModule } from './interactions/interactions.module';
import { Interaction } from './interactions/entities/interaction.entity';
import { PdfGenerationModule } from './pdf-generation/pdf-generation.module';
import { LeaveModule } from './leave/leave.module';
import { Leave } from './leave/entities/leave.entity';
import { UserTarget } from './user/entities/user-target.entity';
import { WarningsModule } from './warnings/warnings.module';
import { Warning } from './warnings/entities/warning.entity';
import { RoleGuard } from './guards/role.guard';
import { ClientCommunicationSchedule } from './clients/entities/client-communication-schedule.entity';
import { ApprovalsModule } from './approvals/approvals.module';
import { Approval } from './approvals/entities/approval.entity';
import { ApprovalHistory } from './approvals/entities/approval-history.entity';
import { ApprovalSignature } from './approvals/entities/approval-signature.entity';
import { Project } from './shop/entities/project.entity';
import { MapModule } from './map/map.module';
import { IotModule } from './iot/iot.module';
import { BulkEmailModule } from './bulk-email/bulk-email.module';
import { Device, DeviceRecords, DeviceLogs } from './iot/entities/iot.entity';
import { SalesTipsModule } from './sales-tips/sales-tips.module';
import { ErpModule } from './erp/erp.module';
import { TblSalesHeader } from './erp/entities/tblsalesheader.entity';
import { TblSalesLines } from './erp/entities/tblsaleslines.entity';
import { TblCustomers } from './erp/entities/tblcustomers.entity';
import { TblCustomerCategories } from './erp/entities/tblcustomercategories.entity';
import { ErpImporterModule } from './erp-importer/erp-importer.module';
import { PayslipsModule } from './payslips/payslips.module';
import { ClerkModule } from './clerk/clerk.module';


@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		CacheModule.register({
			ttl: parseInt(process.env.CACHE_EXPIRATION_TIME || '600', 10) * 1000, // 10 minutes default
			max: parseInt(process.env.CACHE_MAX_ITEMS || '50000', 10) || 50000, // Reduced from 500K to 50K items to prevent memory issues
			isGlobal: true,
		}),
		EventEmitterModule.forRoot(),
		// Main application database connection (PostgreSQL)
		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: (configService: ConfigService) => {
				// Prioritize PG_DB_* env vars, fallback to DATABASE_* for backward compatibility
				let host = configService.get<string>('PG_DB_HOST') || configService.get<string>('DATABASE_HOST');
				let port = parseInt(configService.get<string>('PG_DB_PORT') || configService.get<string>('DATABASE_PORT') || '5432', 10);
				let username = configService.get<string>('PG_DB_USERNAME') || configService.get<string>('DATABASE_USER');
				let password = configService.get<string>('PG_DB_PASSWORD') || configService.get<string>('DATABASE_PASSWORD');
				let database = configService.get<string>('PG_DB_NAME') || configService.get<string>('DATABASE_NAME');
				
				// Parse connection string if PG_DB_HOST contains a full PostgreSQL URL
				if (host && (host.startsWith('postgresql://') || host.startsWith('postgres://'))) {
					try {
						const url = new URL(host);
						// Extract hostname (remove port if present in hostname)
						const hostname = url.hostname;
						// Extract port from URL or use default
						const urlPort = url.port ? parseInt(url.port, 10) : 5432;
						// Extract username and password from URL
						const urlUsername = url.username || username;
						const urlPassword = url.password || password;
						// Extract database name from pathname (remove leading slash)
						const urlDatabase = url.pathname ? url.pathname.slice(1) : database;
						
						// Use parsed values, but allow env vars to override if they're explicitly set
						host = hostname;
						if (!configService.get<string>('PG_DB_PORT') && !configService.get<string>('DATABASE_PORT')) {
							port = urlPort;
						}
						if (!configService.get<string>('PG_DB_USERNAME') && !configService.get<string>('DATABASE_USER')) {
							username = urlUsername;
						}
						if (!configService.get<string>('PG_DB_PASSWORD') && !configService.get<string>('DATABASE_PASSWORD')) {
							password = urlPassword;
						}
						if (!configService.get<string>('PG_DB_NAME') && !configService.get<string>('DATABASE_NAME')) {
							database = urlDatabase;
						}
					} catch (error) {
						console.error('Failed to parse PostgreSQL connection string:', error);
						// Fall back to using host as-is if parsing fails
					}
				}
				
				const isProduction = configService.get<string>('NODE_ENV') === 'production';
				
				// Detect if connecting to Render PostgreSQL (host contains 'dpg-' or 'render.com')
				// Or if connecting to localhost/127.0.0.1 (disable SSL)
				const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host?.startsWith('192.168.') || host?.startsWith('10.');
				const isRender = host?.includes('dpg-') || host?.includes('render.com');
				
				// Enable SSL only for Render PostgreSQL, not for localhost
				const enableSSL = isRender && !isLocalhost;
				
				return {
					type: 'postgres',
					host,
					port,
					username,
					password,
					database,
					entities: [
					User,
					UserTarget,
					UserProfile,
					UserEmployeementProfile,
					Attendance,
					Claim,
					Doc,
					Lead,
					Journal,
					Task,
					Organisation,
					Branch,
					News,
					Asset,
					Tracking,
					Notification,
					Client,
					ClientAuth,
					Product,
					ProductAnalytics,
					Reseller,
					Quotation,
					QuotationItem,
					Banners,
					SubTask,
					Route,
					TaskFlag,
					TaskFlagItem,
					CommunicationLog,
					CheckIn,
					UserRewards,
					Achievement,
					UnlockedItem,
					XPTransaction,
					Report,
					PendingSignup,
					PasswordReset,
					License,
					LicenseUsage,
					LicenseEvent,
					OrganisationSettings,
					OrganisationAppearance,
					OrganisationHours,
					Feedback,
					Competitor,
					Geofence,
					GeofenceEvent,
					Reward,
					Order,
					OrderItem,
					Interaction,
					Leave,
					Warning,
					ClientCommunicationSchedule,
					Approval,
					ApprovalHistory,
					ApprovalSignature,
					Project,
					Device,
					DeviceRecords,
					DeviceLogs,
				],
					synchronize: true,
					logging: false,
					extra: {
						max: parseInt(configService.get<string>('DB_CONNECTION_LIMIT') || '20', 10),
						// Enable SSL only for Render PostgreSQL, disable for localhost
						ssl: enableSSL ? { rejectUnauthorized: false } : false,
					},
					retryAttempts: 10,
					retryDelay: 1000,
					autoLoadEntities: false,
				};
			},
			inject: [ConfigService],
		}),
		// ERP database connection (second database)
		// ✅ PROCESSES ONLY TAX INVOICES (doc_type = 1) - USES GROSS AMOUNTS (incl_line_total)
		// Revenue calculations use incl_line_total without discount subtraction since discounts are already applied to selling prices
		TypeOrmModule.forRootAsync({
			name: 'erp', // Named connection for ERP database
			imports: [ConfigModule],
			useFactory: (configService: ConfigService) => ({
				type: 'mysql',
				host: configService.get<string>('ERP_DATABASE_HOST'),
				port: parseInt(configService.get<string>('ERP_DATABASE_PORT'), 10) || 3306,
				username: configService.get<string>('ERP_DATABASE_USER'),
				password: configService.get<string>('ERP_DATABASE_PASSWORD'),
				database: configService.get<string>('ERP_DATABASE_NAME'),
				entities: [TblSalesHeader, TblSalesLines, TblCustomers, TblCustomerCategories],
				synchronize: false, // CRITICAL: Never sync with ERP database
				logging: false,
				extra: {
					// ✅ INCREASED: Connection pool for ERP to handle parallel queries for Tax Invoices (doc_type = 1)
					// Increased from 30 to 75 to prevent ERRCONRESET under load
					// Supports: 15 concurrent requests × 4 parallel queries + 15 buffer
					connectionLimit: parseInt(configService.get<string>('ERP_DB_CONNECTION_LIMIT') || '75', 10),
					
					// ✅ Connection timeout - fail fast if can't connect (10 seconds)
					connectTimeout: parseInt(configService.get<string>('ERP_DB_CONNECT_TIMEOUT') || '10000', 10),
					
					// ✅ Idle timeout - release idle connections (10 minutes)
					idleTimeout: parseInt(configService.get<string>('ERP_DB_IDLE_TIMEOUT') || '600000', 10),
					
					// ✅ Connection validation and stability
					waitForConnections: true, // Queue requests instead of failing immediately
					queueLimit: 0, // No queue limit - let queries wait rather than fail
					keepAliveInitialDelay: 0,
					enableKeepAlive: true,
					
					// ✅ MySQL-specific optimizations
					dateStrings: false,
					ssl: configService.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
					supportBigNumbers: true,
					bigNumberStrings: false,
					charset: 'utf8mb4',
					timezone: 'Z',
					multipleStatements: false,
					typeCast: true,
				},
				retryAttempts: 10,
				retryDelay: 1000,
				autoLoadEntities: false,
			}),
			inject: [ConfigService],
		}),
		AssetsModule,
		AttendanceModule,
		AuthModule,
		BranchModule,
		ClaimsModule,
		ClientsModule,
		CommunicationModule,
		DocsModule,
		FeedbackModule,
		InteractionsModule,
		JournalModule,
		LeadsModule,
		LibModule,
		NewsModule,
		NotificationsModule,
		OrganisationModule,
		ProductsModule,
		ReportsModule,
		ResellersModule,
		ShopModule,
		TasksModule,
		TrackingModule,
		UserModule,
		CheckInsModule,
		RewardsModule,
		LicensingModule,
		CompetitorsModule,
		ReportsModule,
		ScheduleModule.forRoot(),
		PdfGenerationModule,
		LeaveModule,
		WarningsModule,
		ApprovalsModule,
		MapModule,
		IotModule,
		BulkEmailModule,
		SalesTipsModule,
		ErpModule,
		ErpImporterModule,
		PayslipsModule,
		ClerkModule,
	],
	controllers: [],
	providers: [
		AppService,
		AppController,
		{
			provide: APP_GUARD,
			useClass: RoleGuard,
		},
		{
			provide: APP_INTERCEPTOR,
			useClass: LicenseUsageInterceptor,
		},
	],
})
export class AppModule {}
