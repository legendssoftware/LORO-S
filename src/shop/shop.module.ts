import { forwardRef, Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ProjectsService } from './projects.service';
import { ShopController } from './shop.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quotation } from './entities/quotation.entity';
import { QuotationItem } from './entities/quotation-item.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Banners } from './entities/banners.entity';
import { Project } from './entities/project.entity';
import { BannersService } from './banners.service';
import { ProductsModule } from '../products/products.module';
import { ClientsModule } from '../clients/clients.module';
import { ShopGateway } from './shop.gateway';
import { QuotationConversionService } from './services/quotation-conversion.service';
import { QuotationConversionController } from './controllers/quotation-conversion.controller';
import { Product } from '../products/entities/product.entity';
import { Client } from '../clients/entities/client.entity';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { UserModule } from '../user/user.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { PdfGenerationModule } from '../pdf-generation/pdf-generation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LibModule } from '../lib/lib.module';
import { QuotationPdfListener } from './listeners/quotation-pdf.listener';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			Quotation, 
			QuotationItem, 
			Order, 
			OrderItem, 
			Banners, 
			Product,
			Project,
			Client,
			ClientAuth,
			User,
			Organisation,
			Branch
		]),
		ProductsModule,
		forwardRef(() => ClientsModule),
		LicensingModule,
		UserModule,
		OrganisationModule,
		PdfGenerationModule,
		NotificationsModule,
		LibModule,
	],
	controllers: [ShopController, QuotationConversionController],
	providers: [
		ShopService,
		ProjectsService,
		ShopGateway,
		BannersService,
		QuotationConversionService,
		QuotationPdfListener,
	],
	exports: [
		ShopService, 
		ShopGateway,
		TypeOrmModule
	],
})
export class ShopModule {}
