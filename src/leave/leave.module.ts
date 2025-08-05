import { Module } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';
import { LeaveEmailService } from './services/leave-email.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Leave } from './entities/leave.entity';
import { User } from '../user/entities/user.entity';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { emailTemplateService } from '../lib/services/email-template.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([Leave, User, Organisation, Branch]),
		EventEmitterModule.forRoot(),
		CacheModule.register(),
		ConfigModule,
		JwtModule,
		LicensingModule,
		ApprovalsModule,
	],
	controllers: [LeaveController],
	providers: [
		LeaveService,
		LeaveEmailService,
		{
			provide: 'EmailTemplateService',
			useValue: emailTemplateService,
		},
	],
	exports: [LeaveService, LeaveEmailService],
})
export class LeaveModule {}
