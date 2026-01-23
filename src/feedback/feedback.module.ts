import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { Feedback } from './entities/feedback.entity';
import { Client } from '../clients/entities/client.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Task } from '../tasks/entities/task.entity';
import { User } from '../user/entities/user.entity';
import { ConfigModule } from '@nestjs/config';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { License } from '../licensing/entities/license.entity';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
	imports: [
		ClerkModule,
		TypeOrmModule.forFeature([
			Feedback,
			Client,
			Organisation,
			Branch,
			Task,
			User,
			OrganisationSettings,
			License
		]),
		ConfigModule,
		LicensingModule,
	],
	controllers: [FeedbackController],
	providers: [FeedbackService],
	exports: [FeedbackService],
})
export class FeedbackModule {}
