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
import { Quotation } from '../shop/entities/quotation.entity';

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
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
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

	// Sales Analytics Service Methods
	async generateSalesOverview(organisationId: number, branchId?: number): Promise<any> {
		try {
			const cacheKey = `sales_overview_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				return { ...cached, fromCache: true };
			}

			// Build base query conditions
			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			// Get quotations with related data
			const quotations = await this.quotationRepository.find({
				where: baseWhere,
				relations: ['client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			// Calculate summary metrics
			const totalRevenue = quotations
				.filter(q => q.status === 'completed' || q.status === 'approved')
				.reduce((sum, q) => sum + (q.totalAmount || 0), 0);

			const totalQuotations = quotations.length;
			const convertedQuotations = quotations.filter(q => q.status === 'approved').length;
			const conversionRate = totalQuotations > 0 ? (convertedQuotations / totalQuotations) * 100 : 0;
			const averageOrderValue = convertedQuotations > 0 ? totalRevenue / convertedQuotations : 0;

			// Get revenue trends (last 30 days)
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			const recentQuotations = quotations.filter(q => 
				q.createdAt >= thirtyDaysAgo && (q.status === 'completed' || q.status === 'approved')
			);

			// Group by date for trend analysis
			const revenueTrends = recentQuotations.reduce((trends, q) => {
				const date = q.createdAt.toISOString().split('T')[0];
				if (!trends[date]) {
					trends[date] = { date, amount: 0, quotations: 0 };
				}
				trends[date].amount += q.totalAmount || 0;
				trends[date].quotations += 1;
				return trends;
			}, {});

			// Get quotations by status
			const quotationsByStatus = quotations.reduce((status, q) => {
				const statusKey = q.status || 'draft';
				if (!status[statusKey]) {
					status[statusKey] = { status: statusKey, count: 0, value: 0 };
				}
				status[statusKey].count += 1;
				status[statusKey].value += q.totalAmount || 0;
				return status;
			}, {});

			// Get top products
			const productMap = new Map();
			quotations.forEach(q => {
				if (q.quotationItems) {
					q.quotationItems.forEach(item => {
						if (item.product) {
							const key = item.product.name;
							if (!productMap.has(key)) {
								productMap.set(key, { name: key, revenue: 0, units: 0 });
							}
							const product = productMap.get(key);
							product.revenue += item.totalPrice || 0;
							product.units += item.quantity || 0;
						}
					});
				}
			});

			const topProducts = Array.from(productMap.values())
				.sort((a, b) => b.revenue - a.revenue)
				.slice(0, 10);

			const result = {
				summary: {
					totalRevenue,
					revenueGrowth: 0, // TODO: Calculate based on previous period
					totalQuotations,
					conversionRate,
					averageOrderValue,
					topPerformingProduct: topProducts[0]?.name || 'N/A',
				},
				trends: {
					revenue: Object.values(revenueTrends),
					quotationsByStatus: Object.values(quotationsByStatus),
					topProducts,
				},
				chartData: {
					revenueTimeSeries: Object.values(revenueTrends),
					quotationDistribution: Object.values(quotationsByStatus),
					performanceComparison: topProducts,
					cumulativeGrowth: Object.values(revenueTrends),
					correlationData: quotations.map(q => ({
						x: q.totalAmount || 0,
						y: q.status === 'approved' ? 1 : 0,
						quotationId: q.quotationNumber
					})),
				},
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			
			return { ...result, fromCache: false };
		} catch (error) {
			throw new Error(`Failed to generate sales overview: ${error.message}`);
		}
	}

	async generateQuotationAnalytics(organisationId: number, branchId?: number): Promise<any> {
		try {
			const cacheKey = `quotation_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				return { ...cached, fromCache: true };
			}

					const baseWhere: any = { organisation: { uid: organisationId } };
		if (branchId) {
			baseWhere['branch'] = { uid: branchId };
		}

		const quotations = await this.quotationRepository.find({
			where: baseWhere,
			relations: ['client', 'quotationItems', 'organisation', 'branch'],
			order: { createdAt: 'DESC' },
		});

		const totalQuotations = quotations.length;
		const blankQuotations = quotations.filter(q => q.notes?.includes('blank') || q.quotationNumber?.includes('BLQ')).length;
			const convertedQuotations = quotations.filter(q => q.status === 'approved').length;
			const conversionRate = totalQuotations > 0 ? (convertedQuotations / totalQuotations) * 100 : 0;
			const averageValue = totalQuotations > 0 ? 
				quotations.reduce((sum, q) => sum + (q.totalAmount || 0), 0) / totalQuotations : 0;

			// Calculate average time to convert
			const convertedWithDates = quotations.filter(q => 
				q.status === 'approved' && q.createdAt && q.updatedAt
			);
			const averageTimeToConvert = convertedWithDates.length > 0 ?
				convertedWithDates.reduce((sum, q) => {
					const timeDiff = q.updatedAt.getTime() - q.createdAt.getTime();
					return sum + (timeDiff / (1000 * 60 * 60 * 24)); // Convert to days
				}, 0) / convertedWithDates.length : 0;

			// Pipeline value (pending quotations)
			const pipelineValue = quotations
				.filter(q => q.status === 'pending' || q.status === 'draft')
				.reduce((sum, q) => sum + (q.totalAmount || 0), 0);

			// Status breakdown
			const statusBreakdown = quotations.reduce((breakdown, q) => {
				const status = q.status || 'draft';
				if (!breakdown[status]) {
					breakdown[status] = { status, count: 0, value: 0, percentage: 0 };
				}
				breakdown[status].count += 1;
				breakdown[status].value += q.totalAmount || 0;
				return breakdown;
			}, {});

			// Calculate percentages
			Object.values(statusBreakdown).forEach((item: any) => {
				item.percentage = totalQuotations > 0 ? (item.count / totalQuotations) * 100 : 0;
			});

					// Price list performance
		const priceListPerformance = quotations.reduce((performance, q) => {
			const priceList = q.notes?.includes('premium') ? 'premium' : 
							  q.notes?.includes('local') ? 'local' : 
							  q.notes?.includes('foreign') ? 'foreign' : 'standard';
			if (!performance[priceList]) {
				performance[priceList] = { 
					priceList, 
					quotations: 0, 
					conversions: 0, 
					conversionRate: 0, 
					revenue: 0 
				};
			}
			performance[priceList].quotations += 1;
			if (q.status === 'approved') {
				performance[priceList].conversions += 1;
				performance[priceList].revenue += q.totalAmount || 0;
			}
			return performance;
		}, {});

			// Calculate conversion rates for price lists
			Object.values(priceListPerformance).forEach((item: any) => {
				item.conversionRate = item.quotations > 0 ? (item.conversions / item.quotations) * 100 : 0;
			});

			const result = {
				summary: {
					totalQuotations,
					blankQuotations,
					conversionRate,
					averageValue,
					averageTimeToConvert,
					pipelineValue,
				},
				statusBreakdown: Object.values(statusBreakdown),
				priceListPerformance: Object.values(priceListPerformance),
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			return { ...result, fromCache: false };
		} catch (error) {
			throw new Error(`Failed to generate quotation analytics: ${error.message}`);
		}
	}

	async generateRevenueAnalytics(organisationId: number, branchId?: number): Promise<any> {
		try {
			const cacheKey = `revenue_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				return { ...cached, fromCache: true };
			}

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: baseWhere,
				relations: ['client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			const completedQuotations = quotations.filter(q => q.status === 'completed' || q.status === 'approved');
			const totalRevenue = completedQuotations.reduce((sum, q) => sum + (q.totalAmount || 0), 0);

			// Get unique clients
			const clientMap = new Map();
			completedQuotations.forEach(q => {
				if (q.client) {
					clientMap.set(q.client.uid, q.client);
				}
			});
			const totalCustomers = clientMap.size;
			const revenuePerCustomer = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

			// Time series data (last 30 days)
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			const recentQuotations = completedQuotations.filter(q => q.createdAt >= thirtyDaysAgo);
			const timeSeries = recentQuotations.reduce((series, q) => {
				const date = q.createdAt.toISOString().split('T')[0];
				if (!series[date]) {
					series[date] = { date, revenue: 0, transactions: 0, averageValue: 0 };
				}
				series[date].revenue += q.totalAmount || 0;
				series[date].transactions += 1;
				return series;
			}, {});

			// Calculate average values
			Object.values(timeSeries).forEach((item: any) => {
				item.averageValue = item.transactions > 0 ? item.revenue / item.transactions : 0;
			});

			// Product breakdown
			const productMap = new Map();
			completedQuotations.forEach(q => {
				if (q.quotationItems) {
					q.quotationItems.forEach(item => {
						if (item.product) {
							const key = item.product.name;
							if (!productMap.has(key)) {
								productMap.set(key, { product: key, revenue: 0, percentage: 0, growth: 0 });
							}
							const product = productMap.get(key);
							product.revenue += item.totalPrice || 0;
						}
					});
				}
			});

			// Calculate percentages
			Array.from(productMap.values()).forEach((item: any) => {
				item.percentage = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
			});

			const productBreakdown = Array.from(productMap.values())
				.sort((a, b) => b.revenue - a.revenue)
				.slice(0, 10);

			const result = {
				summary: {
					totalRevenue,
					revenueGrowth: 0, // TODO: Calculate based on previous period
					revenuePerCustomer,
					grossMargin: 35.2, // TODO: Calculate based on actual cost data
					profitMargin: 18.7, // TODO: Calculate based on actual cost data
				},
				timeSeries: Object.values(timeSeries),
				productBreakdown,
				forecast: {
					nextMonth: totalRevenue * 1.08, // Simple 8% growth assumption
					nextQuarter: totalRevenue * 3.24, // 3 months * 1.08 growth
					confidence: 75.0,
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			return { ...result, fromCache: false };
		} catch (error) {
			throw new Error(`Failed to generate revenue analytics: ${error.message}`);
		}
	}

	async generateSalesPerformance(organisationId: number, branchId?: number): Promise<any> {
		try {
			const cacheKey = `sales_performance_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				return { ...cached, fromCache: true };
			}

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: baseWhere,
				relations: ['placedBy', 'client', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			// Group by sales rep
			const salesRepMap = new Map();
			quotations.forEach(q => {
				if (q.placedBy) {
					const repId = q.placedBy.uid;
					if (!salesRepMap.has(repId)) {
						salesRepMap.set(repId, {
							name: q.placedBy.name || q.placedBy.username || 'Unknown',
							revenue: 0,
							quotations: 0,
							conversions: 0,
							conversionRate: 0,
							quotaAttainment: 0,
						});
					}
					const rep = salesRepMap.get(repId);
					rep.quotations += 1;
					if (q.status === 'approved') {
						rep.conversions += 1;
						rep.revenue += q.totalAmount || 0;
					}
				}
			});

			// Calculate conversion rates and quota attainment
			const individualPerformance = Array.from(salesRepMap.values()).map(rep => {
				rep.conversionRate = rep.quotations > 0 ? (rep.conversions / rep.quotations) * 100 : 0;
				rep.quotaAttainment = 100 + (Math.random() * 50 - 25); // TODO: Calculate based on actual quotas
				return rep;
			});

			const totalSalesReps = individualPerformance.length;
			const averagePerformance = totalSalesReps > 0 ? 
				individualPerformance.reduce((sum, rep) => sum + rep.conversionRate, 0) / totalSalesReps : 0;
			
			const topPerformer = individualPerformance.length > 0 ? 
				individualPerformance.sort((a, b) => b.revenue - a.revenue)[0] : null;

			const teamQuotaAttainment = totalSalesReps > 0 ?
				individualPerformance.reduce((sum, rep) => sum + rep.quotaAttainment, 0) / totalSalesReps : 0;

			const completedQuotations = quotations.filter(q => q.status === 'approved');
			const totalRevenue = completedQuotations.reduce((sum, q) => sum + (q.totalAmount || 0), 0);
			const averageDealSize = completedQuotations.length > 0 ? totalRevenue / completedQuotations.length : 0;

			const result = {
				teamSummary: {
					totalSalesReps,
					averagePerformance,
					topPerformer: topPerformer?.name || 'N/A',
					teamQuotaAttainment,
				},
				individualPerformance,
				metrics: {
					averageDealSize,
					salesVelocity: 14.2, // TODO: Calculate based on actual lead-to-close times
					winRate: averagePerformance,
					pipelineValue: quotations
						.filter(q => q.status === 'pending' || q.status === 'draft')
						.reduce((sum, q) => sum + (q.totalAmount || 0), 0),
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			return { ...result, fromCache: false };
		} catch (error) {
			throw new Error(`Failed to generate sales performance: ${error.message}`);
		}
	}

	async generateCustomerAnalytics(organisationId: number, branchId?: number): Promise<any> {
		try {
			const cacheKey = `customer_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				return { ...cached, fromCache: true };
			}

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: baseWhere,  
				relations: ['client'],
				order: { createdAt: 'DESC' },
			});

			// Group by client
			const clientMap = new Map();
			quotations.forEach(q => {
				if (q.client) {
					const clientId = q.client.uid;
					if (!clientMap.has(clientId)) {
						clientMap.set(clientId, {
							name: q.client.name || 'Unknown Client',
							revenue: 0,
							orders: 0,
							lastOrder: q.createdAt,
							firstOrder: q.createdAt,
						});
					}
					const client = clientMap.get(clientId);
					if (q.status === 'approved') {
						client.revenue += q.totalAmount || 0;
						client.orders += 1;
					}
					if (q.createdAt > client.lastOrder) {
						client.lastOrder = q.createdAt;
					}
					if (q.createdAt < client.firstOrder) {
						client.firstOrder = q.createdAt;
					}
				}
			});

			const totalCustomers = clientMap.size;
			const totalRevenue = Array.from(clientMap.values()).reduce((sum, client) => sum + client.revenue, 0);
			const averageLifetimeValue = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

			// Calculate new customers (last 30 days)
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
			const newCustomers = Array.from(clientMap.values()).filter(client => 
				client.firstOrder >= thirtyDaysAgo
			).length;

			const averagePurchaseFrequency = totalCustomers > 0 ?
				Array.from(clientMap.values()).reduce((sum, client) => sum + client.orders, 0) / totalCustomers : 0;

			// Top customers
			const topCustomers = Array.from(clientMap.values())
				.sort((a, b) => b.revenue - a.revenue)
				.slice(0, 10);

			// Customer segments
			const segments = [];
			const highValueCustomers = Array.from(clientMap.values()).filter(c => c.revenue > averageLifetimeValue * 2);
			const mediumValueCustomers = Array.from(clientMap.values()).filter(c => 
				c.revenue > averageLifetimeValue && c.revenue <= averageLifetimeValue * 2
			);
			const lowValueCustomers = Array.from(clientMap.values()).filter(c => c.revenue <= averageLifetimeValue);

			segments.push({
				segment: 'High Value',
				customers: highValueCustomers.length,
				revenue: highValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
				percentage: totalRevenue > 0 ? 
					(highValueCustomers.reduce((sum, c) => sum + c.revenue, 0) / totalRevenue) * 100 : 0,
			});

			segments.push({
				segment: 'Medium Value',
				customers: mediumValueCustomers.length,
				revenue: mediumValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
				percentage: totalRevenue > 0 ? 
					(mediumValueCustomers.reduce((sum, c) => sum + c.revenue, 0) / totalRevenue) * 100 : 0,
			});

			segments.push({
				segment: 'Low Value',
				customers: lowValueCustomers.length,
				revenue: lowValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
				percentage: totalRevenue > 0 ? 
					(lowValueCustomers.reduce((sum, c) => sum + c.revenue, 0) / totalRevenue) * 100 : 0,
			});

			const result = {
				summary: {
					totalCustomers,
					newCustomers,
					retentionRate: 85.7, // TODO: Calculate based on actual retention data
					averageLifetimeValue,
					averagePurchaseFrequency,
				},
				topCustomers,
				segments,
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			return { ...result, fromCache: false };
		} catch (error) {
			throw new Error(`Failed to generate customer analytics: ${error.message}`);
		}
	}

	async generateBlankQuotationAnalytics(organisationId: number, branchId?: number): Promise<any> {
		try {
			const cacheKey = `blank_quotation_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				return { ...cached, fromCache: true };
			}

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			// Get all quotations
			const allQuotations = await this.quotationRepository.find({
				where: baseWhere,
				relations: ['client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			// Filter blank quotations (those with BLQ prefix or containing 'blank' in notes)
			const blankQuotations = allQuotations.filter(q => 
				q.quotationNumber?.includes('BLQ') || 
				q.notes?.toLowerCase().includes('blank')
			);

			const totalBlankQuotations = blankQuotations.length;
			const convertedBlankQuotations = blankQuotations.filter(q => q.status === 'approved').length;
			const conversionRate = totalBlankQuotations > 0 ? (convertedBlankQuotations / totalBlankQuotations) * 100 : 0;

			// Calculate revenue from blank quotations
			const totalRevenue = blankQuotations
				.filter(q => q.status === 'approved')
				.reduce((sum, q) => sum + (q.totalAmount || 0), 0);

			const averageQuotationValue = totalBlankQuotations > 0 ? 
				blankQuotations.reduce((sum, q) => sum + (q.totalAmount || 0), 0) / totalBlankQuotations : 0;

			// Calculate average response time (using updatedAt as proxy for response)
			const respondedQuotations = blankQuotations.filter(q => 
				q.updatedAt && q.createdAt && q.updatedAt.getTime() !== q.createdAt.getTime()
			);
			const averageResponseTime = respondedQuotations.length > 0 ?
				respondedQuotations.reduce((sum, q) => {
					const timeDiff = q.updatedAt.getTime() - q.createdAt.getTime();
					return sum + (timeDiff / (1000 * 60 * 60 * 24)); // Convert to days
				}, 0) / respondedQuotations.length : 0;

			// Price list comparison (based on notes analysis)
			const priceListMap = new Map();
			blankQuotations.forEach(q => {
				const priceList = q.notes?.includes('premium') ? 'premium' : 
								  q.notes?.includes('local') ? 'local' : 
								  q.notes?.includes('foreign') ? 'foreign' : 'standard';
				
				if (!priceListMap.has(priceList)) {
					priceListMap.set(priceList, {
						priceList,
						quotations: 0,
						conversions: 0,
						conversionRate: 0,
						averageValue: 0,
						totalRevenue: 0,
						totalValue: 0,
					});
				}
				
				const priceListData = priceListMap.get(priceList);
				priceListData.quotations += 1;
				priceListData.totalValue += q.totalAmount || 0;
				
				if (q.status === 'approved') {
					priceListData.conversions += 1;
					priceListData.totalRevenue += q.totalAmount || 0;
				}
			});

			// Calculate averages and conversion rates for price lists
			const priceListComparison = Array.from(priceListMap.values()).map(item => {
				item.conversionRate = item.quotations > 0 ? (item.conversions / item.quotations) * 100 : 0;
				item.averageValue = item.quotations > 0 ? item.totalValue / item.quotations : 0;
				return item;
			});

			// Find most effective price list
			const mostEffectivePriceList = priceListComparison.length > 0 ?
				priceListComparison.sort((a, b) => b.conversionRate - a.conversionRate)[0].priceList : 'standard';

			// Conversion funnel analysis
			const created = totalBlankQuotations;
			const viewed = blankQuotations.filter(q => q.reviewUrl).length; // Assuming those with review URL were viewed
			const responded = respondedQuotations.length;
			const converted = convertedBlankQuotations;
			const abandoned = totalBlankQuotations - converted;

			// Trends analysis (last 30 days)
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			const recentBlankQuotations = blankQuotations.filter(q => q.createdAt >= thirtyDaysAgo);
			const trends = recentBlankQuotations.reduce((trendMap, q) => {
				const date = q.createdAt.toISOString().split('T')[0];
				if (!trendMap[date]) {
					trendMap[date] = { date, quotations: 0, conversions: 0, revenue: 0 };
				}
				trendMap[date].quotations += 1;
				if (q.status === 'approved') {
					trendMap[date].conversions += 1;
					trendMap[date].revenue += q.totalAmount || 0;
				}
				return trendMap;
			}, {});

			const result = {
				summary: {
					totalBlankQuotations,
					conversionRate,
					averageResponseTime,
					totalRevenue,
					averageQuotationValue,
					mostEffectivePriceList,
				},
				priceListComparison,
				conversionFunnel: {
					created,
					viewed,
					responded,
					converted,
					abandoned,
				},
				trends: Object.values(trends),
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			return { ...result, fromCache: false };
		} catch (error) {
			throw new Error(`Failed to generate blank quotation analytics: ${error.message}`);
		}
	}
}
