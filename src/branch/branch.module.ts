import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { BranchService } from './branch.service';
import { BranchController } from './branch.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from './entities/branch.entity';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
  imports: [
		ClerkModule,
    LicensingModule,
    TypeOrmModule.forFeature([Branch])
  ],
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService, TypeOrmModule],
})
export class BranchModule { }
