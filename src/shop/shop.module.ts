import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quotation } from './entities/quotation.entity';
import { QuotationItem } from './entities/quotation-item.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Banners } from './entities/banners.entity';
import { BannersService } from './banners.service';
import { ProductsModule } from '../products/products.module';
import { ClientsModule } from '../clients/clients.module';
import { ShopGateway } from './shop.gateway';
import { QuotationConversionService } from './services/quotation-conversion.service';
import { QuotationConversionController } from './controllers/quotation-conversion.controller';
import { Product } from '../products/entities/product.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { UserModule } from '../user/user.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { PdfGenerationModule } from '../pdf-generation/pdf-generation.module';

@Module({
	imports: [
		TypeOrmModule.forFeature([Quotation, QuotationItem, Order, OrderItem, Banners, Product]),
		ProductsModule,
		ClientsModule,
		LicensingModule,
		UserModule,
		OrganisationModule,
		PdfGenerationModule,
	],
	controllers: [ShopController, QuotationConversionController],
	providers: [ShopService, ShopGateway, BannersService, QuotationConversionService],
	exports: [ShopService, ShopGateway],
})
export class ShopModule {}
