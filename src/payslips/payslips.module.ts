import { Module } from '@nestjs/common';
import { PayslipsService } from './payslips.service';
import { PayslipsController } from './payslips.controller';
import { DocsModule } from '../docs/docs.module';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
  imports: [DocsModule, LicensingModule],
  controllers: [PayslipsController],
  providers: [PayslipsService],
})
export class PayslipsModule {}
