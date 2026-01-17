import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ClerkService } from './clerk.service';
import { ClerkController } from './clerk.controller';
import { ClerkAuthGuard } from './clerk.guard';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { UserModule } from '../user/user.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
	imports: [
		ConfigModule,
		TypeOrmModule.forFeature([User, Organisation]),
		UserModule,
		OrganisationModule,
		LicensingModule,
	],
	controllers: [ClerkController],
	providers: [ClerkService, ClerkAuthGuard],
	exports: [ClerkService, ClerkAuthGuard],
})
export class ClerkModule {}
