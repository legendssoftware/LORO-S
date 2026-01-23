import { Module, forwardRef } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organisation } from '../organisation/entities/organisation.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { Report } from './entities/report.entity';
import { MainReportGenerator } from './generators/main-report.generator';
import { QuotationReportGenerator } from './generators/quotation-report.generator';
import { Attendance } from '../attendance/entities/attendance.entity';
import { Claim } from '../claims/entities/claim.entity';
import { Lead } from '../leads/entities/lead.entity';
import { Journal } from '../journal/entities/journal.entity';
import { Task } from '../tasks/entities/task.entity';
import { News } from '../news/entities/news.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Client } from '../clients/entities/client.entity';
import { Product } from '../products/entities/product.entity';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { Doc } from '../docs/entities/doc.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { QuotationItem } from '../shop/entities/quotation-item.entity';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from '../user/user.module';
import { CheckInsModule } from '../check-ins/check-ins.module';
import { ClientsModule } from '../clients/clients.module';
import { CompetitorsModule } from '../competitors/competitors.module';
import { ShopModule } from '../shop/shop.module';
import { TasksModule } from '../tasks/tasks.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { UserDailyReportGenerator } from './generators/user-daily-report.generator';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CommunicationModule } from '../communication/communication.module';
import { Reward } from '../rewards/entities/reward.entity';
import { RewardsModule } from '../rewards/rewards.module';
import { ProductAnalytics } from '../products/entities/product-analytics.entity';
import { TaskFlag } from '../tasks/entities/task-flag.entity';
import { TaskFlagItem } from '../tasks/entities/task-flag-item.entity';
import { Competitor } from '../competitors/entities/competitor.entity';
import { MapDataReportGenerator } from './generators/map-data-report.generator';
import { OrgActivityReportGenerator } from './generators/org-activity-report.generator';
import { PerformanceDashboardGenerator } from './generators/performance-dashboard.generator';
import { UserProfile } from 'src/user/entities/user.profile.entity';
import { UserEmployeementProfile } from 'src/user/entities/user.employeement.profile.entity';
import { UserTarget } from '../user/entities/user-target.entity';
import { License } from 'src/licensing/entities/license.entity';
import { AttendanceModule } from '../attendance/attendance.module';
import { TrackingModule } from '../tracking/tracking.module';
import { UserRewards } from '../rewards/entities/user-rewards.entity';
import { XPTransaction } from '../rewards/entities/xp-transaction.entity';
import { Tracking } from '../tracking/entities/tracking.entity';
import { GoogleMapsService } from '../lib/services/google-maps.service';
import { TrackingService } from '../tracking/tracking.service';
import { ErpModule } from '../erp/erp.module';
import { LeadsModule } from '../leads/leads.module';
import { LeaveModule } from '../leave/leave.module';

@Module({
	imports: [
		ClerkModule,
		LicensingModule,
		ConfigModule,
		ErpModule,
		forwardRef(() => TrackingModule),
		CacheModule.registerAsync({
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => {
				// Ensure TTL is a positive number
				const ttl = Math.max(0, parseInt(configService.get('CACHE_EXPIRATION_TIME', '300'), 10));

				// Ensure max is a non-negative integer
				const max = Math.max(0, parseInt(configService.get('CACHE_MAX_ITEMS', '100'), 10));

				return {
					ttl,
					max,
				};
			},
			inject: [ConfigService],
		}),
		TypeOrmModule.forFeature([
			Organisation,
			Branch,
			User,
			UserProfile,
			UserEmployeementProfile,
			UserTarget,
			UserRewards,
			XPTransaction,
			Report,
			Attendance,
			Claim,
			Lead,
			Journal,
			Task,
			News,
			Asset,
			Client,
			Product,
			ProductAnalytics,
			CheckIn,
			Doc,
			Notification,
			Quotation,
			QuotationItem,
			Reward,
			TaskFlag,
			TaskFlagItem,
			Competitor,
			License,
			Tracking,
		]),
		UserModule,
		CheckInsModule,
		ClientsModule,
		CompetitorsModule,
		ShopModule,
		TasksModule,
		OrganisationModule,
		EventEmitterModule,
		CommunicationModule,
		RewardsModule,
		forwardRef(() => AttendanceModule),
		forwardRef(() => LeadsModule),
		forwardRef(() => LeaveModule),
	],
	controllers: [ReportsController],
	providers: [
		ReportsService,
		MainReportGenerator,
		QuotationReportGenerator,
		UserDailyReportGenerator,
		MapDataReportGenerator,
		OrgActivityReportGenerator,
		PerformanceDashboardGenerator,
		GoogleMapsService,
		TrackingService,
	],
	exports: [TypeOrmModule, ReportsService],
})
export class ReportsModule {}
