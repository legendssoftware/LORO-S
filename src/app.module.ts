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
import { Device, DeviceRecords } from './iot/entities/iot.entity';


@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		CacheModule.register({
			ttl: parseInt(process.env.CACHE_EXPIRATION_TIME || '600', 10) * 1000, // 10 minutes default
			max: parseInt(process.env.CACHE_MAX_ITEMS || '500000', 10) || 500000, // 500K items for high load
			isGlobal: true,
		}),
		EventEmitterModule.forRoot(),
		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: (configService: ConfigService) => ({
				type: 'mysql',
				host: configService.get<string>('DATABASE_HOST'),
				port: parseInt(configService.get<string>('DATABASE_PORT'), 10) || 3306,
				username: configService.get<string>('DATABASE_USER'),
				password: configService.get<string>('DATABASE_PASSWORD'),
				database: configService.get<string>('DATABASE_NAME'),
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
					Task,
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
					Report,
					Interaction,
					Leave,
					Warning,
					ClientCommunicationSchedule,
					Approval,
					ApprovalHistory,
					ApprovalSignature,
					Project,
					// Device,
					// DeviceRecords,
				],
				synchronize: true,
				logging: false,
				extra: {
					connectionLimit: parseInt(configService.get<string>('DB_CONNECTION_LIMIT') || '10', 10), // Reasonable connection limit
					acquireTimeout: parseInt(configService.get<string>('DB_ACQUIRE_TIMEOUT') || '30000', 10), // 30 seconds
					timeout: parseInt(configService.get<string>('DB_QUERY_TIMEOUT') || '30000', 10), // 30 seconds
					reconnect: true,
					idleTimeout: parseInt(configService.get<string>('DB_IDLE_TIMEOUT') || '300000', 10), // 5 minutes
					maxReconnects: parseInt(configService.get<string>('DB_MAX_RECONNECTS') || '10', 10),
					dateStrings: false,
					ssl: configService.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
					// Additional MySQL optimizations for high load
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
