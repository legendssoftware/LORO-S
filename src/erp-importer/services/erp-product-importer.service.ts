import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { TblSalesLines } from '../../erp/entities/tblsaleslines.entity';
import { ErpConnectionManagerService } from '../../erp/services/erp-connection-manager.service';
import { OrganisationService } from '../../organisation/organisation.service';
import { ImportResult } from '../interfaces/import-result.interface';
import { ProductStatus } from '../../lib/enums/product.enums';

@Injectable()
export class ErpProductImporterService {
	private readonly logger = new Logger(ErpProductImporterService.name);

	constructor(
		@InjectRepository(Product)
		private productRepository: Repository<Product>,
		private readonly erpConnectionManager: ErpConnectionManagerService,
		private readonly organisationService: OrganisationService,
	) {}

	async importProducts(
		orgId: number,
		branchId: number,
		countryCode: string = 'SA',
	): Promise<ImportResult> {
		const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

		const organisationUid = await this.organisationService.findClerkOrgIdByUid(orgId);
		if (!organisationUid) {
			this.logger.warn(`No organisation found for uid ${orgId}, skipping product import`);
			return result;
		}

		try {
			// Get unique products from ERP
			const erpProducts = await this.getErpProducts(countryCode);
			this.logger.log(`Found ${erpProducts.length} unique products in ERP`);

			// Get existing products by productReferenceCode
			const existingProducts = await this.productRepository.find({
				where: { organisationUid, isDeleted: false },
				select: ['uid', 'productReferenceCode', 'name'],
			});

			const existingMap = new Map(
				existingProducts.map((p) => [p.productReferenceCode, p]),
			);

			// Process each product
			for (const erpProduct of erpProducts) {
				try {
					const existing = existingMap.get(erpProduct.item_code);

					if (existing) {
						await this.updateProduct(existing.uid, erpProduct);
						result.updated++;
					} else {
						await this.createProduct(erpProduct, organisationUid, branchId);
						result.created++;
					}
				} catch (error) {
					result.errors.push({ code: erpProduct.item_code, error: error.message });
					result.skipped++;
					this.logger.warn(`Failed to import product ${erpProduct.item_code}: ${error.message}`);
				}
			}

			this.logger.log(
				`Product import completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
			);
		} catch (error) {
			this.logger.error(`Product import failed: ${error.message}`, error.stack);
			throw error;
		}

		return result;
	}

	private async getErpProducts(countryCode: string) {
		const connection = await this.erpConnectionManager.getConnection(countryCode);
		const salesLinesRepo = connection.getRepository(TblSalesLines);

		return salesLinesRepo
			.createQueryBuilder('line')
			.select([
				'DISTINCT line.item_code as item_code',
				'line.description as description',
				'line.category as category',
				'AVG(line.incl_price) as avg_price',
				'line.unit as unit',
			])
			.where('line.item_code IS NOT NULL')
			.andWhere("line.item_code != ''")
			.andWhere("line.item_code != '.'")
			.andWhere("line.type = 'I'")
			.groupBy('line.item_code')
			.addGroupBy('line.description')
			.addGroupBy('line.category')
			.addGroupBy('line.unit')
			.getRawMany();
	}

	private async createProduct(erpProduct: any, organisationUid: string, branchId: number) {
		// Generate SKU manually (since we don't have reseller)
		const categoryCode = (erpProduct.category || 'XXX').slice(0, 3).toUpperCase();
		const nameCode = (erpProduct.description || erpProduct.item_code || 'XXX').slice(0, 3).toUpperCase();
		const sku = `${categoryCode}-${nameCode}-000-${erpProduct.item_code.slice(-6).padStart(6, '0')}`;

		const product = this.productRepository.create({
			name: erpProduct.description || erpProduct.item_code,
			description: erpProduct.description || null,
			category: erpProduct.category || null,
			price: erpProduct.avg_price ? parseFloat(erpProduct.avg_price) : null,
			salePrice: erpProduct.avg_price ? parseFloat(erpProduct.avg_price) : null,
			packageUnit: erpProduct.unit || 'unit',
			productReferenceCode: erpProduct.item_code,
			sku: sku,
			organisationUid,
			branchUid: branchId,
			status: ProductStatus.NEW,
			stockQuantity: 0,
			reorderPoint: 10,
			isDeleted: false,
		});

		await this.productRepository.save(product);
	}

	private async updateProduct(productId: number, erpProduct: any) {
		await this.productRepository.update(productId, {
			name: erpProduct.description || erpProduct.item_code,
			description: erpProduct.description || null,
			category: erpProduct.category || null,
			price: erpProduct.avg_price ? parseFloat(erpProduct.avg_price) : null,
			salePrice: erpProduct.avg_price ? parseFloat(erpProduct.avg_price) : null,
			packageUnit: erpProduct.unit || 'unit',
		});
	}
}
