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
import { User } from '../user/entities/user.entity';

@Module({
	imports: [
		TypeOrmModule.forFeature([Claim, User]),
		ConfigModule,
		RewardsModule,
		LicensingModule,
		EventEmitterModule,
		ApprovalsModule,
	],
	controllers: [ClaimsController],
	providers: [ClaimsService, CurrencyService, ClaimStatsService],
	exports: [ClaimsService],
})
export class ClaimsModule {}
