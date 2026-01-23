import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClerkService } from './clerk.service';
import { ClerkController } from './clerk.controller';
import { ClerkAuthGuard } from './clerk.guard';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { UserProfile } from '../user/entities/user.profile.entity';
import { UserEmployeementProfile } from '../user/entities/user.employeement.profile.entity';
import { OrganisationModule } from '../organisation/organisation.module';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
	imports: [
		ConfigModule,
		JwtModule.register({}),
		TypeOrmModule.forFeature([User, Organisation, ClientAuth, UserProfile, UserEmployeementProfile]),
		forwardRef(() => OrganisationModule),
		LicensingModule,
	],
	controllers: [ClerkController],
	providers: [ClerkService, ClerkAuthGuard],
	exports: [ClerkService, ClerkAuthGuard],
})
export class ClerkModule {}
