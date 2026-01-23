import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { Product } from './entities/product.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LicensingModule } from '../licensing/licensing.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { ProductAnalytics } from './entities/product-analytics.entity';

@Module({
  imports: [
		ClerkModule,
    LicensingModule,
    OrganisationModule,
    TypeOrmModule.forFeature([Product, ProductAnalytics])
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService]
})
export class ProductsModule { }
