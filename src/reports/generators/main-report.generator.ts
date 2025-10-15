import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { Claim } from '../../claims/entities/claim.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { Journal } from '../../journal/entities/journal.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { News } from '../../news/entities/news.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { Client } from '../../clients/entities/client.entity';
import { Product } from '../../products/entities/product.entity';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { Doc } from '../../docs/entities/doc.entity';
import { Notification } from '../../notifications/entities/notification.entity';
import { ReportParamsDto } from '../dto/report-params.dto';
import { TimezoneUtil } from '../../lib/utils/timezone.util';
import { OrganizationHoursService } from '../../attendance/services/organization.hours.service';

@Injectable()
export class MainReportGenerator {
	private readonly logger = new Logger(MainReportGenerator.name);

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(Claim)
		private claimRepository: Repository<Claim>,
		@InjectRepository(Lead)
		private leadRepository: Repository<Lead>,
		@InjectRepository(Journal)
		private journalRepository: Repository<Journal>,
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		@InjectRepository(Branch)
		private branchRepository: Repository<Branch>,
		@InjectRepository(News)
		private newsRepository: Repository<News>,
		@InjectRepository(Asset)
		private assetRepository: Repository<Asset>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectRepository(Product)
		private productRepository: Repository<Product>,
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		@InjectRepository(Doc)
		private docRepository: Repository<Doc>,
		@InjectRepository(Notification)
		private notificationRepository: Repository<Notification>,
		private organizationHoursService: OrganizationHoursService,
	) {}

	/**
	 * Get organization timezone with fallback
	 */
	private async getOrganizationTimezone(organizationId?: number): Promise<string> {
		if (!organizationId) {
			return TimezoneUtil.getSafeTimezone();
		}

		try {
			const organizationHours = await this.organizationHoursService.getOrganizationHours(organizationId);
			return organizationHours?.timezone || TimezoneUtil.getSafeTimezone();
		} catch (error) {
			this.logger.warn(`Error getting timezone for org ${organizationId}, using default:`, error);
			return TimezoneUtil.getSafeTimezone();
		}
	}

	/**
	 * Format date in organization timezone for reports
	 */
	private async formatDateInOrganizationTimezone(date: Date, organizationId?: number, format: string = 'yyyy-MM-dd'): Promise<string> {
		if (!date) return 'N/A';
		
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.formatInOrganizationTime(date, format, timezone);
	}

	async generate(params: ReportParamsDto): Promise<Record<string, any>> {
		const { organisationId, branchId, dateRange } = params;

		// Create base filters
		const orgFilter = { organisation: { uid: organisationId } };
		const branchFilter = branchId ? { branch: { uid: branchId } } : {};

		// Create date filter properly using TypeORM Between operator
		let dateFilter = {};
		if (dateRange && dateRange.start && dateRange.end) {
			dateFilter = {
				createdAt: Between(new Date(dateRange.start), new Date(dateRange.end)),
			};
		}

		// Fetch all data in parallel for better performance
		const [
			users,
			attendances,
			claims,
			leads,
			journals,
			tasks,
			branches,
			news,
			assets,
			clients,
			products,
			checkIns,
			docs,
			notifications,
		] = await Promise.all([
			this.userRepository.find({
				where: [
					{
						...orgFilter,
						...branchFilter,
						...dateFilter,
					},
				],
			}),

			this.attendanceRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.claimRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.leadRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.journalRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.taskRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.branchRepository.find({
				where: organisationId ? [{ organisation: { uid: organisationId } }] : [],
			}),

			this.newsRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.assetRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.clientRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.productRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.checkInRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.docRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),

			this.notificationRepository.find({
				where: [{ ...orgFilter, ...branchFilter, ...dateFilter }],
			}),
		]);

		// Return structured report data
		return {
			metadata: {
				organisationId,
				branchId,
				generatedAt: await this.formatDateInOrganizationTimezone(new Date(), organisationId, 'yyyy-MM-dd HH:mm:ss'),
				reportType: 'main',
				name: params.name || 'Main Organization Report',
			},
			summary: {
				userCount: users?.length,
				clientCount: clients?.length,
				leadCount: leads?.length,
				taskCount: tasks?.length,
				productCount: products?.length,
				claimCount: claims?.length,
				checkInCount: checkIns?.length,
				attendanceCount: attendances?.length,
			},
			data: {
				users,
				attendances,
				claims,
				leads,
				journals,
				tasks,
				branches,
				news,
				assets,
				clients,
				products,
				checkIns,
				docs,
				notifications,
			},
		};
	}
}
