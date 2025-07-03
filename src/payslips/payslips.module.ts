import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PayslipsService } from './payslips.service';
import { PayslipsController } from './payslips.controller';
import { Doc } from '../docs/entities/doc.entity';
import { StorageService } from '../lib/services/storage.service';
import { User } from '../user/entities/user.entity';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
  imports: [
    LicensingModule,
    EventEmitterModule,
    TypeOrmModule.forFeature([Doc, User])
  ],
  controllers: [PayslipsController],
  providers: [PayslipsService, StorageService],
  exports: [PayslipsService],
})
export class PayslipsModule {}
