import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RewardsService } from './rewards.service';
import { RewardsController } from './rewards.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { UserRewards } from './entities/user-rewards.entity';
import { Achievement } from './entities/achievement.entity';
import { XPTransaction } from './entities/xp-transaction.entity';
import { RewardsSubscriber } from './rewards.subscriber';
import { UnlockedItem } from './entities/unlocked-item.entity';
import { ClientLoyaltyProfile } from './entities/client-loyalty-profile.entity';
import { LoyaltyPointsTransaction } from './entities/loyalty-points-transaction.entity';
import { LoyaltyReward } from './entities/loyalty-reward.entity';
import { LoyaltyRewardClaim } from './entities/loyalty-reward-claim.entity';
import { VirtualLoyaltyCard } from './entities/virtual-loyalty-card.entity';
import { Client } from '../clients/entities/client.entity';
import { User } from '../user/entities/user.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { CommunicationModule } from '../communication/communication.module';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { ExpoPushService } from '../lib/services/expo-push.service';
import { StorageService } from '../lib/services/storage.service';
import { Doc } from '../docs/entities/doc.entity';

@Module({
  imports: [
		ClerkModule,
    LicensingModule,
    OrganisationModule,
    CommunicationModule,
    TypeOrmModule.forFeature([
      UserRewards,
      Achievement,
      XPTransaction,
      UnlockedItem,
      ClientLoyaltyProfile,
      LoyaltyPointsTransaction,
      LoyaltyReward,
      LoyaltyRewardClaim,
      VirtualLoyaltyCard,
      Client,
      User,
      Doc,
    ])
  ],
  controllers: [RewardsController, LoyaltyController],
  providers: [RewardsService, RewardsSubscriber, LoyaltyService, UnifiedNotificationService, ExpoPushService, StorageService],
  exports: [RewardsService, LoyaltyService]
})
export class RewardsModule { }
