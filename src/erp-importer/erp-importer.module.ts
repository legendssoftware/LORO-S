import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { Client } from '../clients/entities/client.entity';
import { ErpImporterService } from './erp-importer.service';
import { ErpImporterController } from './erp-importer.controller';
import { ErpImporterScheduler } from './erp-importer.scheduler';
import { ErpProductImporterService } from './services/erp-product-importer.service';
import { ErpClientImporterService } from './services/erp-client-importer.service';
import { ErpModule } from '../erp/erp.module';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
	imports: [
		ClerkModule,
		TypeOrmModule.forFeature([Product, Client]),
		ErpModule, // Provides ErpConnectionManagerService
		LicensingModule, // Provides LicensingService for AuthGuard
	],
	controllers: [ErpImporterController],
	providers: [
		ErpImporterService,
		ErpImporterScheduler,
		ErpProductImporterService,
		ErpClientImporterService,
	],
	exports: [ErpImporterService],
})
export class ErpImporterModule {}
