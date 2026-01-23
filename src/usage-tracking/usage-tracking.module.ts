import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { UsageTrackingService } from './usage-tracking.service';
import { UsageTrackingController } from './usage-tracking.controller';
import { UsageEvent } from './entities/usage-event.entity';
import { UsageSummary } from './entities/usage-summary.entity';

@Module({
	imports: [
		ClerkModule,
		TypeOrmModule.forFeature([UsageEvent, UsageSummary]),
		ConfigModule,
		ScheduleModule.forRoot(),
	],
	controllers: [UsageTrackingController],
	providers: [UsageTrackingService],
	exports: [UsageTrackingService],
})
export class UsageTrackingModule {}