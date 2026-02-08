import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { TblCustomers } from '../../erp/entities/tblcustomers.entity';
import { ErpConnectionManagerService } from '../../erp/services/erp-connection-manager.service';
import { OrganisationService } from '../../organisation/organisation.service';
import { ImportResult } from '../interfaces/import-result.interface';
import { GeneralStatus } from '../../lib/enums/status.enums';

@Injectable()
export class ErpClientImporterService {
	private readonly logger = new Logger(ErpClientImporterService.name);

	constructor(
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		private readonly erpConnectionManager: ErpConnectionManagerService,
		private readonly organisationService: OrganisationService,
	) {}

	async importClients(
		orgId: number,
		branchId: number,
		countryCode: string = 'SA',
	): Promise<ImportResult> {
		const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

		const organisationUid = await this.organisationService.findClerkOrgIdByUid(orgId);
		if (!organisationUid) {
			this.logger.warn(`No organisation found for uid ${orgId}, skipping client import`);
			return result;
		}

		try {
			// Get customers from ERP
			const erpCustomers = await this.getErpCustomers(countryCode);
			this.logger.log(`Found ${erpCustomers.length} customers in ERP`);

			// Get existing clients by email/phone
			const existingClients = await this.clientRepository.find({
				where: { organisationUid, isDeleted: false },
				select: ['uid', 'email', 'phone', 'name'],
			});

			const existingByEmail = new Map(
				existingClients.filter((c) => c.email).map((c) => [c.email, c]),
			);
			const existingByPhone = new Map(
				existingClients.filter((c) => c.phone).map((c) => [c.phone, c]),
			);

			// Process each customer
			for (const erpCustomer of erpCustomers) {
				try {
					// Skip if no email and no phone
					if (!erpCustomer.Email && !erpCustomer.Cellphone && !erpCustomer.Tel) {
						result.skipped++;
						continue;
					}

					// Find existing by email or phone
					const email = erpCustomer.Email?.trim() || null;
					const phone = erpCustomer.Cellphone?.trim() || erpCustomer.Tel?.trim() || null;

					const existing =
						(email && existingByEmail.get(email)) ||
						(phone && existingByPhone.get(phone)) ||
						null;

					if (existing) {
						await this.updateClient(existing.uid, erpCustomer);
						result.updated++;
					} else {
						await this.createClient(erpCustomer, organisationUid, branchId);
						result.created++;
					}
				} catch (error) {
					result.errors.push({ code: erpCustomer.Code || 'UNKNOWN', error: error.message });
					result.skipped++;
					this.logger.warn(`Failed to import client ${erpCustomer.Code}: ${error.message}`);
				}
			}

			this.logger.log(
				`Client import completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
			);
		} catch (error) {
			this.logger.error(`Client import failed: ${error.message}`, error.stack);
			throw error;
		}

		return result;
	}

	private async getErpCustomers(countryCode: string) {
		const connection = await this.erpConnectionManager.getConnection(countryCode);
		const customersRepo = connection.getRepository(TblCustomers);

		return customersRepo.find({
			where: {
				Code: Not(IsNull()),
			},
			select: [
				'Code',
				'Description',
				'CustomerName',
				'Email',
				'Cellphone',
				'Tel',
				'Category',
				'category_type',
				'Creditlimit',
				'balance',
				'PhysicalAddress1',
				'PhysicalAddress2',
				'PhysicalAddress3',
				'Address01',
				'Address02',
				'Address03',
				'SalesRep',
			],
		});
	}

	private buildAddress(erpCustomer: any) {
		const physicalParts = [
			erpCustomer.PhysicalAddress1,
			erpCustomer.PhysicalAddress2,
			erpCustomer.PhysicalAddress3,
		].filter((p) => p && p.trim());

		const addressParts = [
			erpCustomer.Address01,
			erpCustomer.Address02,
			erpCustomer.Address03,
		].filter((p) => p && p.trim());

		const streetParts = physicalParts.length > 0 ? physicalParts : addressParts;

		if (streetParts.length === 0) {
			return {
				street: '',
				suburb: '',
				city: '',
				state: '',
				country: '',
				postalCode: '',
			};
		}

		return {
			street: streetParts[0] || '',
			suburb: streetParts[1] || '',
			city: streetParts[2] || '',
			state: '',
			country: '',
			postalCode: '',
		};
	}

	private async createClient(erpCustomer: any, organisationUid: string, branchId: number) {
		const name =
			erpCustomer.Description ||
			erpCustomer.CustomerName ||
			erpCustomer.Code ||
			'Unknown Client';

		const email = erpCustomer.Email?.trim() || null;
		const phone = erpCustomer.Cellphone?.trim() || erpCustomer.Tel?.trim() || null;

		// Validate email format
		const isValidEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

		const client = this.clientRepository.create({
			name,
			contactPerson: erpCustomer.Description || null,
			category: erpCustomer.Category || erpCustomer.category_type || 'contract',
			email: isValidEmail ? email : null,
			phone: phone || null,
			alternativePhone: erpCustomer.Tel && erpCustomer.Tel !== phone ? erpCustomer.Tel : null,
			address: this.buildAddress(erpCustomer),
			creditLimit: erpCustomer.Creditlimit ? parseFloat(erpCustomer.Creditlimit) : 0,
			outstandingBalance: erpCustomer.balance ? parseFloat(erpCustomer.balance) : 0,
			organisationUid,
			branchUid: branchId,
			status: GeneralStatus.ACTIVE,
			isDeleted: false,
		});

		await this.clientRepository.save(client);
	}

	private async updateClient(clientId: number, erpCustomer: any) {
		const name =
			erpCustomer.Description ||
			erpCustomer.CustomerName ||
			erpCustomer.Code ||
			'Unknown Client';

		const email = erpCustomer.Email?.trim() || null;
		const phone = erpCustomer.Cellphone?.trim() || erpCustomer.Tel?.trim() || null;

		const isValidEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

		await this.clientRepository.update(clientId, {
			name,
			contactPerson: erpCustomer.Description || null,
			category: erpCustomer.Category || erpCustomer.category_type || 'contract',
			email: isValidEmail ? email : null,
			phone: phone || null,
			alternativePhone: erpCustomer.Tel && erpCustomer.Tel !== phone ? erpCustomer.Tel : null,
			address: this.buildAddress(erpCustomer),
			creditLimit: erpCustomer.Creditlimit ? parseFloat(erpCustomer.Creditlimit) : 0,
			outstandingBalance: erpCustomer.balance ? parseFloat(erpCustomer.balance) : 0,
		});
	}
}
