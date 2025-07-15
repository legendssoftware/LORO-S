import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { Approval } from './entities/approval.entity';
import { ApprovalHistory } from './entities/approval-history.entity';
import { ApprovalSignature } from './entities/approval-signature.entity';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { UserModule } from '../user/user.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { BranchModule } from '../branch/branch.module';
import { CommunicationModule } from '../communication/communication.module';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Approval,
      ApprovalHistory,
      ApprovalSignature,
      User,
      Organisation,
      Branch
    ]),
    EventEmitterModule,
    UserModule,
    OrganisationModule,
    BranchModule,
    CommunicationModule,
    LicensingModule
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService, TypeOrmModule]
})
export class ApprovalsModule {}
