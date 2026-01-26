import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CreatePayslipDto } from './dto/create-payslip.dto';
import { UpdatePayslipDto } from './dto/update-payslip.dto';
import { DocsService } from '../docs/docs.service';

@Injectable()
export class PayslipsService {
	private readonly logger = new Logger(PayslipsService.name);

	constructor(private readonly docsService: DocsService) {}

	async create(createPayslipDto: CreatePayslipDto, orgId?: number, branchId?: number) {
		this.logger.log(`Creating payslip for user ${createPayslipDto.user?.uid}`, {
			userId: createPayslipDto.user?.uid,
			period: createPayslipDto.period,
			orgId,
			branchId,
		});

		// TODO: Implement actual payslip creation logic
		return {
			message: process.env.SUCCESS_MESSAGE || 'Success',
			payslip: {
				uid: 1,
				...createPayslipDto,
			},
		};
	}

	async findAll(
		filters?: {
			orgId?: number;
			branchId?: number;
			userId?: number;
			startDate?: string;
			endDate?: string;
			status?: string;
		},
		page: number = 1,
		limit: number = 10,
	) {
		this.logger.log(`Finding all payslips with filters: ${JSON.stringify(filters)}`, {
			filters,
			page,
			limit,
		});

		// TODO: Implement actual payslip retrieval logic
		return {
			data: [],
			meta: {
				total: 0,
				page,
				limit,
				totalPages: 0,
			},
			message: process.env.SUCCESS_MESSAGE || 'Success',
		};
	}

	async findByUser(userRef: string, orgId?: number, branchId?: number) {
		this.logger.log(`Finding payslips for user ${userRef}`, {
			userRef,
			orgId,
			branchId,
		});

		// TODO: Implement actual payslip retrieval logic for user
		return {
			data: [],
			message: process.env.SUCCESS_MESSAGE || 'Success',
		};
	}

	async findOne(id: number, orgId?: number, branchId?: number) {
		this.logger.log(`Finding payslip ${id}`, {
			id,
			orgId,
			branchId,
		});

		// TODO: Implement actual payslip retrieval logic
		const payslip = null; // Replace with actual database query

		if (!payslip) {
			this.logger.warn(`Payslip ${id} not found`);
			throw new NotFoundException(process.env.NOT_FOUND_MESSAGE || 'Payslip not found');
		}

		return {
			payslip,
			message: process.env.SUCCESS_MESSAGE || 'Success',
		};
	}

	async update(id: number, updatePayslipDto: UpdatePayslipDto, orgId?: number, branchId?: number) {
		this.logger.log(`Updating payslip ${id}`, {
			id,
			updatePayslipDto,
			orgId,
			branchId,
		});

		// TODO: Implement actual payslip update logic
		return {
			message: process.env.SUCCESS_MESSAGE || 'Success',
		};
	}

	async remove(id: number, orgId?: number, branchId?: number) {
		this.logger.log(`Removing payslip ${id}`, {
			id,
			orgId,
			branchId,
		});

		// TODO: Implement actual payslip deletion logic
		return {
			message: process.env.SUCCESS_MESSAGE || 'Success',
		};
	}

	async getDocumentDownloadUrl(id: number, orgId?: number, branchId?: number) {
		this.logger.log(`Getting document download URL for payslip ${id}`, {
			id,
			orgId,
			branchId,
		});

		// TODO: Implement actual payslip retrieval logic
		// For now, this is a placeholder that demonstrates the expected behavior
		const payslip = null; // Replace with actual database query

		if (!payslip) {
			this.logger.warn(`Payslip ${id} not found`);
			throw new NotFoundException(process.env.NOT_FOUND_MESSAGE || 'Payslip not found');
		}

		// Check if payslip has documentRef (reference to docs table)
		if (payslip.documentRef) {
			try {
				const docResult = await this.docsService.getDownloadUrl(payslip.documentRef);
				return {
					message: 'Download URL generated successfully',
					url: docResult.url,
					fileName: docResult.fileName || `payslip-${id}.pdf`,
					mimeType: docResult.mimeType || 'application/pdf',
				};
			} catch (error) {
				this.logger.error(`Failed to get download URL for document ${payslip.documentRef}: ${error.message}`);
				throw new NotFoundException('Payslip document not found');
			}
		}

		// Fallback to direct documentUrl if available
		if (payslip.documentUrl) {
			return {
				message: 'Download URL generated successfully',
				url: payslip.documentUrl,
				fileName: payslip.payslipNumber ? `payslip-${payslip.payslipNumber}.pdf` : `payslip-${id}.pdf`,
				mimeType: 'application/pdf',
			};
		}

		// No document available
		this.logger.warn(`Payslip ${id} has no document available`);
		throw new NotFoundException('Payslip document not available');
	}
}
