import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { Asset } from './entities/asset.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LicensingModule } from 'src/licensing/licensing.module';
import { ClerkModule } from '../clerk/clerk.module';
import { OrganisationModule } from '../organisation/organisation.module';

@Module({
  imports: [
    ClerkModule,
    LicensingModule,
    OrganisationModule,
    TypeOrmModule.forFeature([Asset])
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService]
})
export class AssetsModule { }
