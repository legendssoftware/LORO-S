import { Module } from '@nestjs/common';
import { GoogleMapsService } from './services/google-maps.service';
import { EventQueueService } from './services/event-queue.service';
import { EventRetryService } from './services/event-retry.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { User } from '../user/entities/user.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { QuotationItem } from '../shop/entities/quotation-item.entity';
import { Client } from '../clients/entities/client.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
	imports: [
		ConfigModule,
		EventEmitterModule.forRoot(),
		CacheModule.register(),
		TypeOrmModule.forFeature([Product, User, Quotation, QuotationItem, Client, Organisation, Branch]),
	],
	providers: [GoogleMapsService, EventQueueService, EventRetryService],
	exports: [GoogleMapsService, EventQueueService, EventRetryService],
})
export class LibModule {}
