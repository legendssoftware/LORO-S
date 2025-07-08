import { Injectable, Inject, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Report } from './entities/report.entity';
import { ReportType } from './constants/report-types.enum';
import { ReportParamsDto } from './dto/report-params.dto';
import { MainReportGenerator } from './generators/main-report.generator';
import { QuotationReportGenerator } from './generators/quotation-report.generator';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { UserDailyReportGenerator } from './generators/user-daily-report.generator';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { User } from '../user/entities/user.entity';
import { CommunicationService } from '../communication/communication.service';
import { EmailType } from '../lib/enums/email.enums';
import { Cron } from '@nestjs/schedule';

import { MapDataReportGenerator } from './generators/map-data-report.generator';

@Injectable()
export class ReportsService implements OnModuleInit {
	private readonly CACHE_PREFIX = 'reports:';
	private readonly CACHE_TTL: number;
	private reportCache = new Map<string, any>();

	constructor(
		@InjectRepository(Report)
		private reportRepository: Repository<Report>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private mainReportGenerator: MainReportGenerator,
		private quotationReportGenerator: QuotationReportGenerator,
		private userDailyReportGenerator: UserDailyReportGenerator,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private eventEmitter: EventEmitter2,
		private communicationService: CommunicationService,
		private readonly mapDataReportGenerator: MapDataReportGenerator,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 300;
	}

	onModuleInit() {}

	// Run every day at 18:00 (6:00 PM)
	@Cron('0 0 18 * * *')
	async generateEndOfDayReports() {
		try {
			// Find users with active attendance records (who haven't checked out yet)
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.innerJoinAndSelect('user.organisation', 'organisation')
				.innerJoin(
					'attendance',
					'attendance',
					'attendance.ownerUid = user.uid AND (attendance.status = :statusPresent OR attendance.status = :statusBreak) AND attendance.checkOut IS NULL',
					{ statusPresent: 'present', statusBreak: 'on break' },
				)
				.where('user.email IS NOT NULL');

			const usersWithActiveShifts = await queryBuilder.getMany();

			if (usersWithActiveShifts.length === 0) {
				return;
			}

			// Generate reports only for users with active shifts
			const results = await Promise.allSettled(
				usersWithActiveShifts.map(async (user) => {
					try {
						if (!user.organisation) {
							return { userId: user.uid, success: false, reason: 'No organisation found' };
						}

						// Check if report already generated today for this user
						const today = new Date();
						today.setHours(0, 0, 0, 0);

						const existingReport = await this.reportRepository.findOne({
							where: {
								owner: { uid: user.uid },
								reportType: ReportType.USER_DAILY,
								generatedAt: MoreThanOrEqual(today),
							},
						});

						if (existingReport) {
							return {
								userId: user.uid,
								success: false,
								reason: 'Report already generated today',
							};
						}

						const params: ReportParamsDto = {
							type: ReportType.USER_DAILY,
							organisationId: user.organisation.uid,
							filters: { userId: user.uid },
						};

						await this.generateUserDailyReport(params);

						return { userId: user.uid, success: true };
					} catch (error) {
						return {
							userId: user.uid,
							success: false,
							reason: error.message,
						};
					}
				}),
			);
		} catch (error) {
			return null;
		}
	}

	private getCacheKey(params: ReportParamsDto): string {
		const { type, organisationId, branchId, dateRange, filters } = params;

		// For quotation reports, include clientId in the cache key
		const clientIdStr = type === ReportType.QUOTATION && filters?.clientId ? `_client${filters.clientId}` : '';

		const dateStr = dateRange ? `_${dateRange.start.toISOString()}_${dateRange.end.toISOString()}` : '';

		return `${this.CACHE_PREFIX}${type}_org${organisationId}${
			branchId ? `_branch${branchId}` : ''
		}${clientIdStr}${dateStr}`;
	}

	async create(createReportDto: CreateReportDto) {
		return 'This action adds a new report';
	}

	async findAll() {
		return this.reportRepository.find();
	}

	async findOne(id: number) {
		return this.reportRepository.findOne({
			where: { uid: id },
			relations: ['organisation', 'branch', 'owner'],
		});
	}

	async update(id: number, updateReportDto: UpdateReportDto) {
		return `This action updates a #${id} report`;
	}

	async remove(id: number) {
		return this.reportRepository.delete(id);
	}

	@OnEvent('daily-report')
	async handleDailyReport(payload: { userId: number }) {
		try {
			if (!payload || !payload.userId) {
				return;
			}

			const { userId } = payload;

			// Get user to find their organization
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user || !user.organisation) {
				return;
			}

			// Create report parameters
			const params: ReportParamsDto = {
				type: ReportType.USER_DAILY,
				organisationId: user.organisation.uid,
				filters: {
					userId: userId,
					// Use default date range (today)
				},
			};

			// Generate and save the report
			await this.generateUserDailyReport(params);
		} catch (error) {
			return null;
		}
	}

	async generateUserDailyReport(params: ReportParamsDto): Promise<Report> {
		try {
			const { userId } = params.filters || {};

			if (!userId) {
				throw new Error('User ID is required for generating a daily user report');
			}

			// Get user data
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user) {
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			// Generate report data
			const reportData = await this.userDailyReportGenerator.generate(params);

			// Create a new report record
			const newReport = new Report();
			newReport.name = `Daily Report - ${user.name} - ${new Date().toISOString().split('T')[0]}`;
			newReport.description = `Daily activity report for ${user.name}`;
			newReport.reportType = ReportType.USER_DAILY;
			newReport.filters = params.filters;
			newReport.reportData = reportData;
			newReport.generatedAt = new Date();
			newReport.owner = user;
			newReport.organisation = user.organisation;

			// Save the report
			const savedReport = await this.reportRepository.save(newReport);

			// Emit event to send email (single email delivery)
			this.eventEmitter.emit('report.generated', {
				reportType: ReportType.USER_DAILY,
				reportId: savedReport.uid,
				userId: user.uid,
				emailData: reportData.emailData,
			});

			return savedReport;
		} catch (error) {
			return null;
		}
	}

	async generateReport(params: ReportParamsDto, currentUser: any): Promise<Record<string, any>> {
		// Check cache first
		const cacheKey = this.getCacheKey(params);
		const cachedReport = await this.cacheManager.get<Record<string, any>>(cacheKey);

		if (cachedReport) {
			return {
				...cachedReport,
				fromCache: true,
				cachedAt: cachedReport.generatedAt,
				currentTime: new Date().toISOString(),
			};
		}

		// Generate report data based on type
		let reportData: Record<string, any>;

		switch (params.type) {
			case ReportType.MAIN:
				reportData = await this.mainReportGenerator.generate(params);
				break;
			case ReportType.QUOTATION:
				reportData = await this.quotationReportGenerator.generate(params);
				break;
			case ReportType.USER_DAILY:
				reportData = await this.userDailyReportGenerator.generate(params);
				break;
			case ReportType.USER:
				// Will be implemented later
				throw new Error('User report type not implemented yet');
			case ReportType.SHIFT:
				// Will be implemented later
				throw new Error('Shift report type not implemented yet');
			default:
				throw new Error(`Unknown report type: ${params.type}`);
		}

		// Prepare the report response with metadata
		const report = {
			name: params.name || `${params.type} Report`,
			type: params.type,
			generatedAt: new Date(),
			filters: {
				organisationId: params.organisationId,
				branchId: params.branchId,
				dateRange: params.dateRange,
				...params.filters, // Include any additional filters
			},
			generatedBy: {
				uid: currentUser.uid,
			},
			...reportData,
		};

		// Cache the report
		await this.cacheManager.set(cacheKey, report, this.CACHE_TTL);

		// Return the report data directly without saving to database
		return report;
	}

	@OnEvent('report.generated')
	async handleReportGenerated(payload: { reportType: ReportType; reportId: number; userId: number; emailData: any }) {
		try {
			if (payload.reportType === ReportType.USER_DAILY) {
				await this.sendUserDailyReportEmail(payload.userId, payload.emailData);
			}
		} catch (error) {
			return null;
		}
	}

	private async sendUserDailyReportEmail(userId: number, emailData: any) {
		try {
			// Get user with full profile
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user || !user.email) {
				return;
			}

			// Ensure emailData has the correct format
			if (!emailData || !emailData.name || !emailData.date || !emailData.metrics) {
				throw new Error('Invalid email data format');
			}

			// Validate required fields for the email template
			if (!emailData.metrics.attendance) {
				emailData.metrics.attendance = {
					status: 'NOT_PRESENT',
					totalHours: 0,
				};
			}

			// Make sure all required fields are present
			if (!emailData.metrics.totalQuotations) {
				emailData.metrics.totalQuotations = 0;
			}

			if (!emailData.metrics.totalRevenue) {
				emailData.metrics.totalRevenue = 'R0.00';
			}

			// Create tracking section if missing
			if (!emailData.tracking) {
				emailData.tracking = {
					totalDistance: '0 km',
					locations: [],
					averageTimePerLocation: '0 min',
				};
			}

			// Use a direct cast to any to work around typing issues
			const emailService = this.communicationService as any;
			try {
				await emailService.sendEmail(EmailType.USER_DAILY_REPORT, [user.email], emailData);
			} catch (emailError) {
				return null;
			}
		} catch (error) {
			// Record the error in the report record
			try {
				const report = await this.reportRepository.findOne({
					where: { owner: { uid: userId }, reportType: ReportType.USER_DAILY },
					order: { generatedAt: 'DESC' },
				});

				if (report) {
					report.notes = `Email delivery failed: ${error.message}`;
					await this.reportRepository.save(report);
				}
			} catch (dbError) {
				return null;
			}
		}
	}

	/**
	 * Clears all cached reports for a specific organization
	 * @param organisationId The organization ID
	 * @param reportType Optional specific report type to clear
	 * @returns Number of cache keys cleared
	 */
	async clearOrganizationReportCache(organisationId: number, reportType?: ReportType): Promise<number> {
		try {
			const cacheKeyPattern = reportType
				? `${this.CACHE_PREFIX}${reportType}_org${organisationId}*`
				: `${this.CACHE_PREFIX}*_org${organisationId}*`;

			// For redis-based cache this would use a scan/delete pattern
			// For the built-in cache we can only delete specific keys
			// Since we don't know what cache implementation is being used, we'll log this
			// This method would need to be enhanced to properly clear cache based on pattern

			return 0;
		} catch (error) {
			return 0;
		}
	}

	/**
	 * Gets all branch IDs for an organization
	 * @param organisationId The organization ID
	 * @returns Array of branch IDs
	 */
	private async getBranchIdsForOrganization(organisationId: number): Promise<number[]> {
		try {
			// This assumes there's a branch repository with a findByOrganisation method
			const branches = await this.reportRepository
				.createQueryBuilder('r')
				.select('DISTINCT r.branchUid', 'branchId')
				.where('r.organisationUid = :organisationId', { organisationId })
				.andWhere('r.branchUid IS NOT NULL')
				.getRawMany();

			return branches.map((b) => b.branchId);
		} catch (error) {
			return [];
		}
	}

	// Event handlers for cache invalidation
	@OnEvent('task.created')
	@OnEvent('task.updated')
	@OnEvent('task.deleted')
	async handleTaskChange(payload: { organisationId: number; branchId?: number }) {
		if (!payload || !payload.organisationId) return;
		await this.clearOrganizationReportCache(payload.organisationId);
	}

	@OnEvent('lead.created')
	@OnEvent('lead.updated')
	@OnEvent('lead.deleted')
	async handleLeadChange(payload: { organisationId: number; branchId?: number }) {
		if (!payload || !payload.organisationId) return;
		await this.clearOrganizationReportCache(payload.organisationId);
	}

	@OnEvent('quotation.created')
	@OnEvent('quotation.updated')
	@OnEvent('quotation.deleted')
	async handleQuotationChange(payload: { organisationId: number; branchId?: number }) {
		if (!payload || !payload.organisationId) return;
		await this.clearOrganizationReportCache(payload.organisationId);
	}

	/* ---------------------------------------------------------
	 * MAP-DATA helper (live map screen)
	 * -------------------------------------------------------*/
	async generateMapData(params: { organisationId: number; branchId?: number }): Promise<any> {
		const cacheKey = `${this.CACHE_PREFIX}mapdata_org${params.organisationId}_${params.branchId || 'all'}`;

		// Try cache first
		const cached = await this.cacheManager.get(cacheKey);
		if (cached) {
			return cached;
		}

		const data = await this.mapDataReportGenerator.generate(params);

		// Basic summary counts to match previous response structure
		const summary = {
			totalWorkers: data.workers.length,
			totalClients: data.clients.length,
			totalCompetitors: data.competitors.length,
			totalQuotations: data.quotations.length,
		};

		const finalPayload = { data, summary };

		await this.cacheManager.set(cacheKey, finalPayload, this.CACHE_TTL);

		return finalPayload;
	}
}
