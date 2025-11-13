import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { JwtModule } from '@nestjs/jwt';
import { LicensingModule } from '../licensing/licensing.module';
import { TblSalesHeader } from './entities/tblsalesheader.entity';
import { TblSalesLines } from './entities/tblsaleslines.entity';
import { TblCustomers } from './entities/tblcustomers.entity';
import { TblCustomerCategories } from './entities/tblcustomercategories.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { ErpDataService } from './services/erp-data.service';
import { ErpTransformerService } from './services/erp-transformer.service';
import { ErpCacheWarmerService } from './services/erp-cache-warmer.service';
import { ErpTargetsService } from './services/erp-targets.service';
import { ErpHealthIndicator } from './erp.health';
import { ErpController } from './erp.controller';

/**
 * ERP Module
 * 
 * Handles all interactions with the ERP database for sales data.
 * Uses a separate database connection ('erp') configured in app.module.ts.
 * 
 * Features:
 * - Sequential query execution (one query at a time)
 * - Aggressive caching with automatic warming
 * - Data transformation to performance dashboard format
 * - Optimized aggregations
 */
@Module({
	imports: [
		// Register ERP entities with the 'erp' connection
		TypeOrmModule.forFeature([TblSalesHeader, TblSalesLines, TblCustomers, TblCustomerCategories], 'erp'),
		// Register OrganisationSettings with default connection for targets
		TypeOrmModule.forFeature([OrganisationSettings]),
		// Cache module for query result caching
		CacheModule.register({
			ttl: 3600, // 1 hour
			max: 1000, // Max 1000 cached items
		}),
		// JWT module for AuthGuard
		JwtModule.register({
			secret: process.env.JWT_SECRET,
			signOptions: { expiresIn: '8h' },
		}),
		// Licensing module for license validation in AuthGuard
		LicensingModule,
	],
	controllers: [ErpController],
	providers: [
		ErpDataService,
		ErpTransformerService,
		ErpCacheWarmerService,
		ErpTargetsService,
		ErpHealthIndicator,
	],
	exports: [
		ErpDataService,
		ErpTransformerService,
		ErpCacheWarmerService,
		ErpTargetsService,
		ErpHealthIndicator,
	],
})
export class ErpModule {}

