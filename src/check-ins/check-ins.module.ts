import { Module } from '@nestjs/common';
import { CheckInsService } from './check-ins.service';
import { CheckInsController } from './check-ins.controller';
import { CheckIn } from './entities/check-in.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RewardsModule } from '../rewards/rewards.module';
import { LicensingModule } from '../licensing/licensing.module';
import { User } from '../user/entities/user.entity';
import { Client } from 'src/clients/entities/client.entity';
import { OrganisationModule } from '../organisation/organisation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LibModule } from '../lib/lib.module';

@Module({
	imports: [
		LicensingModule,
		TypeOrmModule.forFeature([CheckIn, User, Client]),
		RewardsModule,
		OrganisationModule,
		NotificationsModule,
		LibModule,
	],
	controllers: [CheckInsController],
	providers: [CheckInsService],
	exports: [CheckInsService, TypeOrmModule],
})
export class CheckInsModule {}
