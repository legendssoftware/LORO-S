import { forwardRef, Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { ClientCommunicationScheduleService } from './services/client-communication-schedule.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from './entities/client.entity';
import { ClientAuth } from './entities/client.auth.entity';
import { ClientCommunicationSchedule } from './entities/client-communication-schedule.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { ConfigModule } from '@nestjs/config';
import { LibModule } from '../lib/lib.module';
import { Organisation } from '../organisation/entities/organisation.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { User } from '../user/entities/user.entity';
import { Task } from '../tasks/entities/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    LicensingModule,
    TypeOrmModule.forFeature([Client, ClientAuth, ClientCommunicationSchedule, Organisation, OrganisationSettings, User, Task]),
    ConfigModule,
    LibModule,
    TasksModule,
    forwardRef(() => AttendanceModule),
    NotificationsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [ClientsController],
  providers: [ClientsService, ClientCommunicationScheduleService],
  exports: [ClientsService, ClientCommunicationScheduleService, TypeOrmModule]
})
export class ClientsModule { }
