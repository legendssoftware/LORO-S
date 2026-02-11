import { forwardRef, Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Attendance } from './entities/attendance.entity';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { UserModule } from '../user/user.module';
import { RewardsModule } from '../rewards/rewards.module';
import { LicensingModule } from '../licensing/licensing.module';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { OrganizationHoursService } from './services/organization.hours.service';
import { AttendanceCalculatorService } from './services/attendance.calculator.service';
import { AttendanceReportsService } from './services/attendance.reports.service';
import { OvertimeReminderService } from './services/overtime.reminder.service';
import { BranchLocationCheckService } from './services/branch-location-check.service';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Tracking } from '../tracking/entities/tracking.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunicationModule } from '../communication/communication.module';
import { Report } from '../reports/entities/report.entity';
import { ReportsModule } from '../reports/reports.module';
import { LibModule } from '../lib/lib.module';

@Module({
	imports: [
		ClerkModule,
		LicensingModule,
		TypeOrmModule.forFeature([
			Attendance,
			CheckIn,
			User,
			Organisation,
			OrganisationHours,
			OrganisationSettings,
			Notification,
			Report,
			Branch,
			Tracking,
		]),
		forwardRef(() => UserModule),
		RewardsModule,
		NotificationsModule,
		CommunicationModule,
		forwardRef(() => ReportsModule),
		LibModule,
		CacheModule.registerAsync({
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => {
				const ttl = configService.get<number>('CACHE_EXPIRATION_TIME', 30) * 1000;
				const maxItems = parseInt(configService.get('CACHE_MAX_ITEMS', '100'), 10);
				return {
					ttl,
					max: isNaN(maxItems) || maxItems <= 0 ? 100 : maxItems,
				};
			},
			inject: [ConfigService],
		}),
	],
	controllers: [AttendanceController],
	providers: [
		AttendanceService,
		OrganizationHoursService,
		AttendanceCalculatorService,
		AttendanceReportsService,
		OvertimeReminderService,
		BranchLocationCheckService,
	],
	exports: [
		AttendanceService,
		OrganizationHoursService,
		AttendanceCalculatorService,
		AttendanceReportsService,
		OvertimeReminderService,
	],
})
export class AttendanceModule {}
