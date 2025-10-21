import { forwardRef, Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { Task } from './entities/task.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubTask } from './entities/subtask.entity';
import { RewardsModule } from '../rewards/rewards.module';
import { LicensingModule } from '../licensing/licensing.module';
import { Client } from '../clients/entities/client.entity';
import { User } from '../user/entities/user.entity';
import { ConfigModule } from '@nestjs/config';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { CommunicationModule } from '../communication/communication.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TaskReminderService } from './task-reminder.service';
import { TaskRouteService } from './task-route.service';
import { Route } from './entities/route.entity';
import { GoogleMapsService } from '../lib/services/google-maps.service';
import { ScheduleModule } from '@nestjs/schedule';
import { TaskFlag } from './entities/task-flag.entity';
import { TaskFlagItem } from './entities/task-flag-item.entity';
import { UserModule } from '../user/user.module';
import { UserService } from '../user/user.service';
import { OrganisationModule } from '../organisation/organisation.module';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { OrganisationAppearance } from '../organisation/entities/organisation-appearance.entity';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
	imports: [
		LicensingModule,
		TypeOrmModule.forFeature([
			Task,
			SubTask,
			Client,
			User,
			Organisation,
			Branch,
			Route,
			TaskFlag,
			TaskFlagItem,
			OrganisationSettings,
			OrganisationAppearance,
			OrganisationHours,
		]),
		RewardsModule,
		ConfigModule,
		CommunicationModule,
		NotificationsModule,
		ScheduleModule.forRoot(),
		UserModule,
		OrganisationModule,
		forwardRef(() => AttendanceModule),
	],
	controllers: [TasksController],
	providers: [TasksService, TaskReminderService, TaskRouteService, GoogleMapsService, UserService],
	exports: [TasksService],
})
export class TasksModule {}
