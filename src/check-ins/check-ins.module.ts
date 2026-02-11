import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ClerkModule } from '../clerk/clerk.module';
import { CheckInsService } from './check-ins.service';
import { CheckInsController } from './check-ins.controller';
import { CheckIn } from './entities/check-in.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RewardsModule } from '../rewards/rewards.module';
import { LicensingModule } from '../licensing/licensing.module';
import { User } from '../user/entities/user.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { OrganisationModule } from '../organisation/organisation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LibModule } from '../lib/lib.module';
import { LeadsModule } from '../leads/leads.module';
import { Quotation } from '../shop/entities/quotation.entity';
import { CommunicationModule } from '../communication/communication.module';
import { PdfGenerationModule } from '../pdf-generation/pdf-generation.module';
import { CheckInsReportsService } from './services/check-ins-reports.service';
import { CheckInsReportsScheduler } from './services/check-ins-reports.scheduler';

@Module({
	imports: [
		ScheduleModule,
		ClerkModule,
		LicensingModule,
		TypeOrmModule.forFeature([CheckIn, User, Client, Organisation, OrganisationHours, Quotation]),
		RewardsModule,
		OrganisationModule,
		NotificationsModule,
		LibModule,
		forwardRef(() => LeadsModule),
		CommunicationModule,
		PdfGenerationModule,
	],
	controllers: [CheckInsController],
	providers: [CheckInsService, CheckInsReportsService, CheckInsReportsScheduler],
	exports: [CheckInsService, TypeOrmModule],
})
export class CheckInsModule {}
