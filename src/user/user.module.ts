import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserAuthController } from './user-auth.controller';
import { UserAuthService } from './user-auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user.profile.entity';
import { UserEmployeementProfile } from './entities/user.employeement.profile.entity';
import { OrganisationModule } from '../organisation/organisation.module';
import { BranchModule } from '../branch/branch.module';
import { UserTarget } from './entities/user-target.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { RewardsModule } from '../rewards/rewards.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CheckIn } from 'src/check-ins/entities/check-in.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { Order } from '../shop/entities/order.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Lead } from 'src/leads/entities/lead.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Device } from '../iot/entities/iot.entity';
import { ClerkModule } from '../clerk/clerk.module';

@Module({
	imports: [
		ScheduleModule.forRoot(),
		TypeOrmModule.forFeature([
			User,
			UserProfile,
			UserEmployeementProfile,
			Quotation,
			Order,
			Lead,
			Client,
			CheckIn,
			UserTarget,
			Branch,
			Device,
		]),
		OrganisationModule,
		BranchModule,
		LicensingModule,
		RewardsModule,
		NotificationsModule,
		forwardRef(() => ClerkModule),
	],
	controllers: [UserController, UserAuthController],
	providers: [UserService, UserAuthService],
	exports: [UserService, UserAuthService, TypeOrmModule],
})
export class UserModule {}
