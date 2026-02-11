import { forwardRef, Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { Lead } from './entities/lead.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RewardsModule } from '../rewards/rewards.module';
import { LicensingModule } from 'src/licensing/licensing.module';
import { LeadsReminderService } from './leads-reminder.service';
import { LeadScoringService } from './lead-scoring.service';
import { User } from '../user/entities/user.entity';
import { Interaction } from '../interactions/entities/interaction.entity';
import { CommunicationModule } from '../communication/communication.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { Task } from '../tasks/entities/task.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClerkModule } from '../clerk/clerk.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { Client } from '../clients/entities/client.entity';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [
    LicensingModule,
    TypeOrmModule.forFeature([Lead, User, Interaction, Task, Organisation, Client]),
    forwardRef(() => ClientsModule),
    RewardsModule,
    CommunicationModule,
    NotificationsModule,
    forwardRef(() => TasksModule),
    ClerkModule,
    OrganisationModule,
    forwardRef(() => AttendanceModule)
  ],
  controllers: [LeadsController],
  providers: [LeadsService, LeadsReminderService, LeadScoringService],
  exports: [LeadsService, LeadScoringService, TypeOrmModule],
})
export class LeadsModule { }
