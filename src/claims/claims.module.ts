import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { Claim } from './entities/claim.entity';
import { CurrencyService } from './utils/currency.service';
import { ClaimStatsService } from './utils/stats.service';
import { ConfigModule } from '@nestjs/config';
import { RewardsModule } from '../rewards/rewards.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LicensingModule } from '../licensing/licensing.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Approval } from '../approvals/entities/approval.entity';
import { ClerkModule } from '../clerk/clerk.module';

@Module({
	imports: [
		ClerkModule,
		TypeOrmModule.forFeature([Claim, User, Organisation, Approval]),
		ConfigModule,
		RewardsModule,
		LicensingModule,
		EventEmitterModule,
		ApprovalsModule,
		NotificationsModule,
	],
	controllers: [ClaimsController],
	providers: [ClaimsService, CurrencyService, ClaimStatsService],
	exports: [ClaimsService],
})
export class ClaimsModule {}
