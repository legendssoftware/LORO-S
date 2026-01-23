import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { JournalService } from './journal.service';
import { JournalController } from './journal.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Journal } from './entities/journal.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { RewardsModule } from '../rewards/rewards.module';
import { LicensingModule } from '../licensing/licensing.module';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
		ClerkModule,
    LicensingModule,
    TypeOrmModule.forFeature([Journal, Organisation]),
    RewardsModule,
    CacheModule.register(),
    ConfigModule
  ],
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService]
})
export class JournalModule { }
