import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InteractionsService } from './interactions.service';
import { InteractionsController } from './interactions.controller';
import { Interaction } from './entities/interaction.entity';
import { Lead } from '../leads/entities/lead.entity';
import { Client } from '../clients/entities/client.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
	imports: [ClerkModule, TypeOrmModule.forFeature([Interaction, Lead, Client, Organisation]), LicensingModule],
	controllers: [InteractionsController],
	providers: [InteractionsService],
	exports: [InteractionsService],
})
export class InteractionsModule {}
