import { Module, forwardRef, Inject } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../user/entities/user.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { RewardsModule } from '../rewards/rewards.module';
import { OrderNotificationsService } from './order-notifications.service';
import { LicensingModule } from '../licensing/licensing.module';
import { ExpoPushService } from '../lib/services/expo-push.service';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [
		ClerkModule,
    LicensingModule,
    TypeOrmModule.forFeature([Notification, User, ClientAuth]),
    RewardsModule,
    forwardRef(() => CommunicationModule)
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService, 
    OrderNotificationsService, 
    ExpoPushService,
    UnifiedNotificationService
  ],
  exports: [
    NotificationsService, 
    OrderNotificationsService, 
    ExpoPushService,
    UnifiedNotificationService
  ]
})
export class NotificationsModule { }
