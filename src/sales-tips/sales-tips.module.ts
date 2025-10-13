import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SalesTipsService } from './sales-tips.service';
import { SalesTipsController } from './sales-tips.controller';
import { User } from '../user/entities/user.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { ExpoPushService } from '../lib/services/expo-push.service';
import { Notification } from '../notifications/entities/notification.entity';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Notification]),
    ScheduleModule.forRoot(),
    forwardRef(() => CommunicationModule), // Import CommunicationModule for CommunicationService
  ],
  controllers: [SalesTipsController],
  providers: [SalesTipsService, UnifiedNotificationService, ExpoPushService],
  exports: [SalesTipsService],
})
export class SalesTipsModule {}
