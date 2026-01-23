import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { PayslipsService } from './payslips.service';
import { PayslipsController } from './payslips.controller';
import { DocsModule } from '../docs/docs.module';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
  imports: [ClerkModule, DocsModule, LicensingModule],
  controllers: [PayslipsController],
  providers: [PayslipsService],
})
export class PayslipsModule {}
