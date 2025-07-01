import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayslipsService } from './payslips.service';
import { PayslipsController } from './payslips.controller';
import { Doc } from '../docs/entities/doc.entity';
import { StorageService } from '../lib/services/storage.service';
import { User } from '../user/entities/user.entity';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
  imports: [
    LicensingModule,
    TypeOrmModule.forFeature([Doc, User])
  ],
  controllers: [PayslipsController],
  providers: [PayslipsService, StorageService],
  exports: [PayslipsService],
})
export class PayslipsModule {}
