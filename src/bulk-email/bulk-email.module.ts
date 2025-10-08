import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BulkEmailService } from './bulk-email.service';
import { CommunicationService } from '../communication/communication.service';
import { CommunicationLog } from '../communication/entities/communication-log.entity';
import { ShopModule } from '../shop/shop.module';
import { LeadsModule } from '../leads/leads.module';
import { ClientsModule } from '../clients/clients.module';
import { CheckInsModule } from '../check-ins/check-ins.module';
import { BranchModule } from '../branch/branch.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { UserModule } from '../user/user.module';

@Module({
	imports: [
		TypeOrmModule.forFeature([CommunicationLog]),
		UserModule,
		ShopModule,
		LeadsModule,
		ClientsModule,
		CheckInsModule,
		BranchModule,
		NotificationsModule,
		OrganisationModule,
	],
	providers: [
		BulkEmailService,
		CommunicationService,
	],
	exports: [BulkEmailService],
})
export class BulkEmailModule {}
