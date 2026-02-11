import { forwardRef, Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsWebSocketService } from './approvals-websocket.service';
import { Approval } from './entities/approval.entity';
import { ApprovalHistory } from './entities/approval-history.entity';
import { ApprovalSignature } from './entities/approval-signature.entity';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { UserModule } from '../user/user.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { BranchModule } from '../branch/branch.module';
import { CommunicationModule } from '../communication/communication.module';
import { LicensingModule } from '../licensing/licensing.module';
import { ShopModule } from '../shop/shop.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
		ClerkModule,
    TypeOrmModule.forFeature([
      Approval,
      ApprovalHistory,
      ApprovalSignature,
      User,
      Organisation,
      Branch
    ]),
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const ttl = Math.max(0, parseInt(configService.get('CACHE_EXPIRATION_TIME', '300'), 10));
        const max = Math.max(0, parseInt(configService.get('CACHE_MAX_ITEMS', '100'), 10));

        return {
          ttl,
          max,
        };
      },
      inject: [ConfigService],
    }),
    ConfigModule,
    EventEmitterModule,
    forwardRef(() => UserModule),
    OrganisationModule,
    BranchModule,
    CommunicationModule,
    LicensingModule,
    forwardRef(() => ShopModule),
    NotificationsModule
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalsWebSocketService],
  exports: [ApprovalsService, ApprovalsWebSocketService, TypeOrmModule]
})
export class ApprovalsModule {}
