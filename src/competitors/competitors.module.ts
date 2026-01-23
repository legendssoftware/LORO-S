import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CompetitorsService } from './competitors.service';
import { CompetitorsController } from './competitors.controller';
import { Competitor } from './entities/competitor.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';

@Module({
	imports: [
		ClerkModule,
		LicensingModule,
		TypeOrmModule.forFeature([Competitor, User, Organisation, Branch, OrganisationSettings]),
		CacheModule.register(),
		ConfigModule,
	],
	controllers: [CompetitorsController],
	providers: [CompetitorsService],
	exports: [CompetitorsService],
})
export class CompetitorsModule {}
