import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommunicationService } from './communication.service';
import { CommunicationController } from './communication.controller';
import { UserModule } from '../user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunicationLog } from './entities/communication-log.entity';

@Module({
  imports: [
    UserModule,
    ScheduleModule.forRoot(), // Enable cron jobs and scheduling
    TypeOrmModule.forFeature([CommunicationLog])
  ],
  controllers: [CommunicationController],
  providers: [
    CommunicationService
  ],
  exports: [
    CommunicationService
  ],
})
export class CommunicationModule { }
