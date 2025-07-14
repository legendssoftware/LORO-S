import { Injectable, Inject, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
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
	private readonly logger = new Logger(ReportsService.name);
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
		this.logger.log(`Reports service initialized with cache TTL: ${this.CACHE_TTL}s`);
	}

	onModuleInit() {
		this.logger.log('Reports service module initialized successfully');
	}

	// Run every day at 18:00 (6:00 PM)
	@Cron('0 0 18 * * *')
	async generateEndOfDayReports() {
		this.logger.log('Starting end-of-day reports generation');
		
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
			this.logger.log(`Found ${usersWithActiveShifts.length} users with active shifts for end-of-day reports`);

			if (usersWithActiveShifts.length === 0) {
				this.logger.log('No users with active shifts found, skipping end-of-day report generation');
				return;
			}

			// Generate reports only for users with active shifts
			const results = await Promise.allSettled(
				usersWithActiveShifts.map(async (user) => {
					try {
						this.logger.debug(`Processing end-of-day report for user ${user.uid} (${user.email})`);
						
						if (!user.organisation) {
							this.logger.warn(`User ${user.uid} has no organisation, skipping report`);
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
							this.logger.debug(`Report already generated today for user ${user.uid}`);
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
						this.logger.log(`Successfully generated end-of-day report for user ${user.uid}`);

						return { userId: user.uid, success: true };
					} catch (error) {
						this.logger.error(`Failed to generate end-of-day report for user ${user.uid}: ${error.message}`, error.stack);
						return {
							userId: user.uid,
							success: false,
							reason: error.message,
						};
					}
				}),
			);

			const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
			const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
			
			this.logger.log(`End-of-day reports completed: ${successful} successful, ${failed} failed`);
		} catch (error) {
			this.logger.error(`Critical error in generateEndOfDayReports: ${error.message}`, error.stack);
			return null;
		}
	}

	private getCacheKey(params: ReportParamsDto): string {
		const { type, organisationId, branchId, dateRange, filters } = params;

		// For quotation reports, include clientId in the cache key
		const clientIdStr = type === ReportType.QUOTATION && filters?.clientId ? `_client${filters.clientId}` : '';

		const dateStr = dateRange ? `_${dateRange.start.toISOString()}_${dateRange.end.toISOString()}` : '';

		const cacheKey = `${this.CACHE_PREFIX}${type}_org${organisationId}${
			branchId ? `_branch${branchId}` : ''
		}${clientIdStr}${dateStr}`;

		this.logger.debug(`Generated cache key: ${cacheKey}`);
		return cacheKey;
	}

	async create(createReportDto: CreateReportDto) {
		this.logger.log('Creating new report');
		this.logger.debug(`Create report DTO: ${JSON.stringify(createReportDto)}`);
		return 'This action adds a new report';
	}

	async findAll() {
		this.logger.log('Fetching all reports');
		try {
			const reports = await this.reportRepository.find();
			this.logger.log(`Found ${reports.length} reports`);
			return reports;
		} catch (error) {
			this.logger.error(`Error fetching all reports: ${error.message}`, error.stack);
			throw error;
		}
	}

	async findOne(id: number) {
		this.logger.log(`Fetching report with ID: ${id}`);
		try {
			const report = await this.reportRepository.findOne({
				where: { uid: id },
				relations: ['organisation', 'branch', 'owner'],
			});
			
			if (!report) {
				this.logger.warn(`Report with ID ${id} not found`);
			} else {
				this.logger.log(`Successfully fetched report ${id}`);
			}
			
			return report;
		} catch (error) {
			this.logger.error(`Error fetching report ${id}: ${error.message}`, error.stack);
			throw error;
		}
	}

	async update(id: number, updateReportDto: UpdateReportDto) {
		this.logger.log(`Updating report with ID: ${id}`);
		this.logger.debug(`Update report DTO: ${JSON.stringify(updateReportDto)}`);
		return `This action updates a #${id} report`;
	}

	async remove(id: number) {
		this.logger.log(`Removing report with ID: ${id}`);
		try {
			const result = await this.reportRepository.delete(id);
			this.logger.log(`Successfully removed report ${id}`);
			return result;
		} catch (error) {
			this.logger.error(`Error removing report ${id}: ${error.message}`, error.stack);
			throw error;
		}
	}

	@OnEvent('daily-report')
	async handleDailyReport(payload: { userId: number }) {
		this.logger.log(`Handling daily report event for user ${payload?.userId}`);
		
		try {
			if (!payload || !payload.userId) {
				this.logger.error('Invalid payload for daily report event');
				return;
			}

			const { userId } = payload;

			// Get user to find their organization
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user || !user.organisation) {
				this.logger.warn(`User ${userId} or organisation not found for daily report`);
				return;
			}

			this.logger.log(`Processing daily report for user ${userId} in organisation ${user.organisation.uid}`);

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
			this.logger.log(`Successfully processed daily report for user ${userId}`);
		} catch (error) {
			this.logger.error(`Error handling daily report for user ${payload?.userId}: ${error.message}`, error.stack);
			return null;
		}
	}

	async generateUserDailyReport(params: ReportParamsDto): Promise<Report> {
		this.logger.log(`Generating user daily report with params: ${JSON.stringify(params)}`);
		
		try {
			const { userId } = params.filters || {};

			if (!userId) {
				this.logger.error('User ID is required for generating a daily user report');
				throw new Error('User ID is required for generating a daily user report');
			}

			// Get user data
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user) {
				this.logger.error(`User with ID ${userId} not found`);
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			this.logger.log(`Generating daily report for user ${user.name} (${user.email})`);

			// Generate report data
			const reportData = await this.userDailyReportGenerator.generate(params);
			this.logger.log(`Report data generated successfully for user ${userId}`);

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
			this.logger.log(`Daily report saved with ID: ${savedReport.uid} for user ${userId}`);

			// Emit event to send email (single email delivery)
			this.eventEmitter.emit('report.generated', {
				reportType: ReportType.USER_DAILY,
				reportId: savedReport.uid,
				userId: user.uid,
				emailData: reportData.emailData,
			});

			this.logger.log(`Daily report generation completed for user ${userId}`);
			return savedReport;
		} catch (error) {
			this.logger.error(`Error generating user daily report: ${error.message}`, error.stack);
			return null;
		}
	}

	async generateReport(params: ReportParamsDto, currentUser: any): Promise<Record<string, any>> {
		this.logger.log(`Generating report of type: ${params.type} for organisation: ${params.organisationId}`);
		this.logger.debug(`Report parameters: ${JSON.stringify(params)}`);
		
		// Check cache first
		const cacheKey = this.getCacheKey(params);
		const cachedReport = await this.cacheManager.get<Record<string, any>>(cacheKey);

		if (cachedReport) {
			this.logger.log(`Report found in cache: ${cacheKey}`);
			return {
				...cachedReport,
				fromCache: true,
				cachedAt: cachedReport.generatedAt,
				currentTime: new Date().toISOString(),
			};
		}

		this.logger.log(`Generating fresh report for type: ${params.type}`);

		// Generate report data based on type
		let reportData: Record<string, any>;

		try {
			switch (params.type) {
				case ReportType.MAIN:
					this.logger.log('Generating main report');
					reportData = await this.mainReportGenerator.generate(params);
					break;
				case ReportType.QUOTATION:
					this.logger.log('Generating quotation report');
					reportData = await this.quotationReportGenerator.generate(params);
					break;
				case ReportType.USER_DAILY:
					this.logger.log('Generating user daily report');
					reportData = await this.userDailyReportGenerator.generate(params);
					break;
				case ReportType.USER:
					this.logger.error('User report type not implemented yet');
					throw new Error('User report type not implemented yet');
				case ReportType.SHIFT:
					this.logger.error('Shift report type not implemented yet');
					throw new Error('Shift report type not implemented yet');
				default:
					this.logger.error(`Unknown report type: ${params.type}`);
					throw new Error(`Unknown report type: ${params.type}`);
			}

			this.logger.log(`Report data generated successfully for type: ${params.type}`);
		} catch (error) {
			this.logger.error(`Error generating report data: ${error.message}`, error.stack);
			throw error;
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
		try {
			await this.cacheManager.set(cacheKey, report, this.CACHE_TTL);
			this.logger.log(`Report cached successfully: ${cacheKey}`);
		} catch (error) {
			this.logger.error(`Error caching report: ${error.message}`, error.stack);
		}

		this.logger.log(`Report generation completed for type: ${params.type}`);
		
		// Return the report data directly without saving to database
		return report;
	}

	@OnEvent('report.generated')
	async handleReportGenerated(payload: { reportType: ReportType; reportId: number; userId: number; emailData: any }) {
		this.logger.log(`Handling report generated event - Type: ${payload.reportType}, ID: ${payload.reportId}, User: ${payload.userId}`);
		
		try {
			if (payload.reportType === ReportType.USER_DAILY) {
				await this.sendUserDailyReportEmail(payload.userId, payload.emailData);
			}
		} catch (error) {
			this.logger.error(`Error handling report generated event: ${error.message}`, error.stack);
			return null;
		}
	}

	private async sendUserDailyReportEmail(userId: number, emailData: any) {
		this.logger.log(`Sending daily report email to user ${userId}`);
		
		try {
			// Get user with full profile
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user || !user.email) {
				this.logger.warn(`User ${userId} not found or has no email address`);
				return;
			}

			// Ensure emailData has the correct format
			if (!emailData || !emailData.name || !emailData.date || !emailData.metrics) {
				this.logger.error(`Invalid email data format for user ${userId}`);
				throw new Error('Invalid email data format');
			}

			// Validate required fields for the email template
			if (!emailData.metrics.attendance) {
				this.logger.warn(`No attendance data for user ${userId}, using defaults`);
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
				this.logger.log(`Daily report email sent successfully to ${user.email}`);
			} catch (emailError) {
				this.logger.error(`Failed to send daily report email to ${user.email}: ${emailError.message}`, emailError.stack);
				return null;
			}
		} catch (error) {
			this.logger.error(`Error sending daily report email to user ${userId}: ${error.message}`, error.stack);
			
			// Record the error in the report record
			try {
				const report = await this.reportRepository.findOne({
					where: { owner: { uid: userId }, reportType: ReportType.USER_DAILY },
					order: { generatedAt: 'DESC' },
				});

				if (report) {
					report.notes = `Email delivery failed: ${error.message}`;
					await this.reportRepository.save(report);
					this.logger.log(`Error logged to report ${report.uid}`);
				}
			} catch (dbError) {
				this.logger.error(`Failed to log email error to database: ${dbError.message}`, dbError.stack);
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
		this.logger.log(`Clearing organization report cache for org ${organisationId}${reportType ? ` and type ${reportType}` : ''}`);
		
		try {
			const cacheKeyPattern = reportType
				? `${this.CACHE_PREFIX}${reportType}_org${organisationId}*`
				: `${this.CACHE_PREFIX}*_org${organisationId}*`;

			this.logger.debug(`Cache key pattern: ${cacheKeyPattern}`);

			// For redis-based cache this would use a scan/delete pattern
			// For the built-in cache we can only delete specific keys
			// Since we don't know what cache implementation is being used, we'll log this
			// This method would need to be enhanced to properly clear cache based on pattern

			this.logger.log(`Cache clearing completed for organization ${organisationId}`);
			return 0;
		} catch (error) {
			this.logger.error(`Error clearing organization report cache: ${error.message}`, error.stack);
			return 0;
		}
	}

	/**
	 * Gets all branch IDs for an organization
	 * @param organisationId The organization ID
	 * @returns Array of branch IDs
	 */
	private async getBranchIdsForOrganization(organisationId: number): Promise<number[]> {
		this.logger.debug(`Getting branch IDs for organization ${organisationId}`);
		
		try {
			// This assumes there's a branch repository with a findByOrganisation method
			const branches = await this.reportRepository
				.createQueryBuilder('r')
				.select('DISTINCT r.branchUid', 'branchId')
				.where('r.organisationUid = :organisationId', { organisationId })
				.andWhere('r.branchUid IS NOT NULL')
				.getRawMany();

			this.logger.debug(`Found ${branches.length} branches for organization ${organisationId}`);
			return branches.map((b) => b.branchId);
		} catch (error) {
			this.logger.error(`Error getting branch IDs for organization ${organisationId}: ${error.message}`, error.stack);
			return [];
		}
	}

	// Event handlers for cache invalidation
	@OnEvent('task.created')
	@OnEvent('task.updated')
	@OnEvent('task.deleted')
	async handleTaskChange(payload: { organisationId: number; branchId?: number }) {
		this.logger.log(`Handling task change event for organization ${payload?.organisationId}`);
		if (!payload || !payload.organisationId) return;
		await this.clearOrganizationReportCache(payload.organisationId);
	}

	@OnEvent('lead.created')
	@OnEvent('lead.updated')
	@OnEvent('lead.deleted')
	async handleLeadChange(payload: { organisationId: number; branchId?: number }) {
		this.logger.log(`Handling lead change event for organization ${payload?.organisationId}`);
		if (!payload || !payload.organisationId) return;
		await this.clearOrganizationReportCache(payload.organisationId);
	}

	@OnEvent('quotation.created')
	@OnEvent('quotation.updated')
	@OnEvent('quotation.deleted')
	async handleQuotationChange(payload: { organisationId: number; branchId?: number }) {
		this.logger.log(`Handling quotation change event for organization ${payload?.organisationId}`);
		if (!payload || !payload.organisationId) return;
		await this.clearOrganizationReportCache(payload.organisationId);
	}

	/* ---------------------------------------------------------
	 * MAP-DATA helper (live map screen)
	 * -------------------------------------------------------*/
	async generateMapData(params: { organisationId: number; branchId?: number }): Promise<any> {
		this.logger.log(`Generating map data for organization ${params.organisationId}${params.branchId ? ` and branch ${params.branchId}` : ''}`);
		
		const cacheKey = `${this.CACHE_PREFIX}mapdata_org${params.organisationId}_${params.branchId || 'all'}`;

		// Try cache first
		const cached = await this.cacheManager.get(cacheKey);
		if (cached) {
			this.logger.log(`Map data found in cache: ${cacheKey}`);
			return cached;
		}

		try {
			const data = await this.mapDataReportGenerator.generate(params);
			this.logger.log(`Map data generated successfully for organization ${params.organisationId}`);

			// Basic summary counts to match previous response structure
			const summary = {
				totalWorkers: data.workers.length,
				totalClients: data.clients.length,
				totalCompetitors: data.competitors.length,
				totalQuotations: data.quotations.length,
			};

			const finalPayload = { data, summary };

			await this.cacheManager.set(cacheKey, finalPayload, this.CACHE_TTL);
			this.logger.log(`Map data cached successfully: ${cacheKey}`);

			return finalPayload;
		} catch (error) {
			this.logger.error(`Error generating map data: ${error.message}`, error.stack);
			throw error;
		}
	}

	// Sales Analytics Service Methods
	async generateSalesOverview(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating sales overview for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `sales_overview_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Sales overview found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh sales overview for organization ${organisationId}`);

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

			this.logger.log(`Found ${quotations.length} quotations for sales overview`);

			// Calculate summary metrics
			const totalRevenue = quotations
				.filter(q => q.status === 'completed' || q.status === 'approved')
				.reduce((sum, q) => sum + (q.totalAmount || 0), 0);

			const totalQuotations = quotations.length;
			const convertedQuotations = quotations.filter(q => q.status === 'approved').length;
			const conversionRate = totalQuotations > 0 ? (convertedQuotations / totalQuotations) * 100 : 0;
			const averageOrderValue = convertedQuotations > 0 ? totalRevenue / convertedQuotations : 0;

			this.logger.log(`Sales overview metrics - Revenue: ${totalRevenue}, Quotations: ${totalQuotations}, Conversion: ${conversionRate}%`);

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

			// Calculate revenue growth (compared to previous 30 days)
			const sixtyDaysAgo = new Date();
			sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
			const previousPeriodQuotations = quotations.filter(q => 
				q.createdAt >= sixtyDaysAgo && q.createdAt < thirtyDaysAgo && 
				(q.status === 'completed' || q.status === 'approved')
			);
			const previousPeriodRevenue = previousPeriodQuotations.reduce((sum, q) => sum + (q.totalAmount || 0), 0);
			const revenueGrowth = previousPeriodRevenue > 0 ? 
				((totalRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100 : 0;

			const result = {
				summary: {
					totalRevenue,
					revenueGrowth,
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
			this.logger.log(`Sales overview cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating sales overview: ${error.message}`, error.stack);
			throw new Error(`Failed to generate sales overview: ${error.message}`);
		}
	}

	async generateQuotationAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating quotation analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `quotation_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Quotation analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh quotation analytics for organization ${organisationId}`);

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: baseWhere,
				relations: ['client', 'quotationItems', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			this.logger.log(`Found ${quotations.length} quotations for analytics`);

			const totalQuotations = quotations.length;
			const blankQuotations = quotations.filter(q => q.notes?.includes('blank') || q.quotationNumber?.includes('BLQ')).length;
			const convertedQuotations = quotations.filter(q => q.status === 'approved').length;
			const conversionRate = totalQuotations > 0 ? (convertedQuotations / totalQuotations) * 100 : 0;
			const averageValue = totalQuotations > 0 ? 
				quotations.reduce((sum, q) => sum + (q.totalAmount || 0), 0) / totalQuotations : 0;

			this.logger.log(`Quotation analytics metrics - Total: ${totalQuotations}, Blank: ${blankQuotations}, Converted: ${convertedQuotations}`);

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

			// Calculate monthly trends (last 12 months)
			const monthlyTrends = [];
			for (let i = 11; i >= 0; i--) {
				const date = new Date();
				date.setMonth(date.getMonth() - i);
				const month = date.toLocaleDateString('en-US', { month: 'short' });
				const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
				const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
				
				const monthlyQuotations = quotations.filter(q => 
					q.createdAt >= monthStart && q.createdAt <= monthEnd
				);
				
				monthlyTrends.push({
					month,
					count: monthlyQuotations.length,
				});
			}

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
				chartData: {
					statusDistribution: Object.values(statusBreakdown).map((item: any) => ({
						name: item.status,
						value: item.count,
					})),
					monthlyTrends,
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Quotation analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating quotation analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate quotation analytics: ${error.message}`);
		}
	}

	async generateRevenueAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating revenue analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `revenue_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Revenue analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh revenue analytics for organization ${organisationId}`);

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: baseWhere,
				relations: ['client', 'quotationItems', 'quotationItems.product', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			this.logger.log(`Found ${quotations.length} quotations for revenue analytics`);

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

			this.logger.log(`Revenue analytics metrics - Total revenue: ${totalRevenue}, Customers: ${totalCustomers}`);

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

			// Calculate revenue growth (compared to previous period)
			const sixtyDaysAgo = new Date();
			sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
			const previousPeriodRevenue = quotations
				.filter(q => q.createdAt >= sixtyDaysAgo && q.createdAt < thirtyDaysAgo && 
							(q.status === 'completed' || q.status === 'approved'))
				.reduce((sum, q) => sum + (q.totalAmount || 0), 0);
			const revenueGrowth = previousPeriodRevenue > 0 ? 
				((totalRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100 : 0;

			// Calculate current month revenue
			const currentMonth = new Date();
			const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
			const currentMonthRevenue = quotations
				.filter(q => q.createdAt >= monthStart && (q.status === 'completed' || q.status === 'approved'))
				.reduce((sum, q) => sum + (q.totalAmount || 0), 0);

			const result = {
				summary: {
					totalRevenue,
					revenueGrowth,
					monthlyRevenue: currentMonthRevenue,
					topProduct: productBreakdown[0]?.product || 'N/A',
					averageOrderValue: completedQuotations.length > 0 ? totalRevenue / completedQuotations.length : 0,
					revenuePerCustomer,
					grossMargin: 0, // Note: Requires cost data not available in current schema
					profitMargin: 0, // Note: Requires cost data not available in current schema
				},
				timeSeries: Object.values(timeSeries),
				productBreakdown,
				chartData: {
					monthlyRevenue: Object.values(timeSeries).map((item: any) => ({
						month: new Date(item.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
						revenue: item.revenue,
					})),
				},
				forecast: {
					nextMonth: totalRevenue * 1.08, // Simple 8% growth assumption
					nextQuarter: totalRevenue * 3.24, // 3 months * 1.08 growth
					confidence: 75.0,
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Revenue analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating revenue analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate revenue analytics: ${error.message}`);
		}
	}

	async generateSalesPerformance(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating sales performance for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `sales_performance_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Sales performance found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh sales performance for organization ${organisationId}`);

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: baseWhere,
				relations: ['placedBy', 'client', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			this.logger.log(`Found ${quotations.length} quotations for sales performance`);

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
				// Note: Quota attainment requires quota data not available in current schema
				rep.quotaAttainment = 0; 
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

			this.logger.log(`Sales performance metrics - Reps: ${totalSalesReps}, Avg performance: ${averagePerformance}%, Top performer: ${topPerformer?.name || 'None'}`);

			const result = {
				summary: {
					topPerformer: topPerformer?.name || 'N/A',
					topPerformerRevenue: topPerformer?.revenue || 0,
					teamPerformance: averagePerformance,
					targetAchievement: teamQuotaAttainment,
				},
				teamSummary: {
					totalSalesReps,
					averagePerformance,
					topPerformer: topPerformer?.name || 'N/A',
					teamQuotaAttainment,
				},
				individualPerformance,
				chartData: {
					teamPerformance: individualPerformance.map(rep => ({
						name: rep.name,
						revenue: rep.revenue,
					})),
					targetVsAchievement: Array.from({ length: 12 }, (_, i) => {
						const month = new Date(0, i).toLocaleDateString('en-US', { month: 'short' });
						return {
							month,
							target: averageDealSize * (i + 1),
							achievement: averageDealSize * (i + 1) * (averagePerformance / 100),
						};
					}),
				},
				metrics: {
					averageDealSize,
					salesVelocity: 0, // Note: Requires accurate lead-to-close tracking
					winRate: averagePerformance,
					pipelineValue: quotations
						.filter(q => q.status === 'pending' || q.status === 'draft')
						.reduce((sum, q) => sum + (q.totalAmount || 0), 0),
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Sales performance cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating sales performance: ${error.message}`, error.stack);
			throw new Error(`Failed to generate sales performance: ${error.message}`);
		}
	}

	async generateCustomerAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating customer analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `customer_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Customer analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh customer analytics for organization ${organisationId}`);

			const baseWhere: any = { organisation: { uid: organisationId } };
			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const quotations = await this.quotationRepository.find({
				where: baseWhere,  
				relations: ['client'],
				order: { createdAt: 'DESC' },
			});

			this.logger.log(`Found ${quotations.length} quotations for customer analytics`);

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

			this.logger.log(`Customer analytics metrics - Total customers: ${totalCustomers}, Total revenue: ${totalRevenue}, Avg LTV: ${averageLifetimeValue}`);

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
				name: 'High Value',
				segment: 'enterprise',
				customers: highValueCustomers.length,
				revenue: highValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
				percentage: totalRevenue > 0 ? 
					(highValueCustomers.reduce((sum, c) => sum + c.revenue, 0) / totalRevenue) * 100 : 0,
				value: highValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
			});

			segments.push({
				name: 'Medium Value',
				segment: 'sme',
				customers: mediumValueCustomers.length,
				revenue: mediumValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
				percentage: totalRevenue > 0 ? 
					(mediumValueCustomers.reduce((sum, c) => sum + c.revenue, 0) / totalRevenue) * 100 : 0,
				value: mediumValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
			});

			segments.push({
				name: 'Low Value',
				segment: 'startup',
				customers: lowValueCustomers.length,
				revenue: lowValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
				percentage: totalRevenue > 0 ? 
					(lowValueCustomers.reduce((sum, c) => sum + c.revenue, 0) / totalRevenue) * 100 : 0,
				value: lowValueCustomers.reduce((sum, c) => sum + c.revenue, 0),
			});

			// Calculate acquisition trend (last 12 months)
			const acquisitionTrend = [];
			for (let i = 11; i >= 0; i--) {
				const date = new Date();
				date.setMonth(date.getMonth() - i);
				const month = date.toLocaleDateString('en-US', { month: 'short' });
				const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
				const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
				
				const monthlyNewCustomers = Array.from(clientMap.values()).filter(client => 
					client.firstOrder >= monthStart && client.firstOrder <= monthEnd
				).length;
				
				acquisitionTrend.push({
					month,
					newCustomers: monthlyNewCustomers,
				});
			}

			const result = {
				summary: {
					totalCustomers,
					newCustomers,
					retentionRate: 0, // Note: Requires historical customer data tracking
					averageLifetimeValue,
					averagePurchaseFrequency,
				},
				topCustomers,
				segments,
				chartData: {
					acquisitionTrend,
					customerSegments: segments.map(segment => ({
						name: segment.name,
						value: segment.value,
					})),
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Customer analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating customer analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate customer analytics: ${error.message}`);
		}
	}

	async generateBlankQuotationAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating blank quotation analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `blank_quotation_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Blank quotation analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh blank quotation analytics for organization ${organisationId}`);

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

			this.logger.log(`Found ${blankQuotations.length} blank quotations out of ${allQuotations.length} total quotations`);

			const totalBlankQuotations = blankQuotations.length;
			const convertedBlankQuotations = blankQuotations.filter(q => q.status === 'approved').length;
			const conversionRate = totalBlankQuotations > 0 ? (convertedBlankQuotations / totalBlankQuotations) * 100 : 0;

			// Calculate revenue from blank quotations
			const totalRevenue = blankQuotations
				.filter(q => q.status === 'approved')
				.reduce((sum, q) => sum + (q.totalAmount || 0), 0);

			const averageQuotationValue = totalBlankQuotations > 0 ? 
				blankQuotations.reduce((sum, q) => sum + (q.totalAmount || 0), 0) / totalBlankQuotations : 0;

			this.logger.log(`Blank quotation analytics metrics - Total: ${totalBlankQuotations}, Converted: ${convertedBlankQuotations}, Revenue: ${totalRevenue}`);

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

			// Calculate creation trend (last 12 months)
			const creationTrend = [];
			for (let i = 11; i >= 0; i--) {
				const date = new Date();
				date.setMonth(date.getMonth() - i);
				const month = date.toLocaleDateString('en-US', { month: 'short' });
				const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
				const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
				
				const monthlyBlankQuotations = blankQuotations.filter(q => 
					q.createdAt >= monthStart && q.createdAt <= monthEnd
				);
				
				creationTrend.push({
					month,
					count: monthlyBlankQuotations.length,
				});
			}

			const result = {
				summary: {
					totalBlankQuotations,
					completionRate: conversionRate,
					averageCompletionTime: averageResponseTime,
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
				chartData: {
					creationTrend,
					blankQuotationStatus: [
						{ name: 'Approved', value: converted },
						{ name: 'Pending', value: responded - converted },
						{ name: 'Abandoned', value: abandoned },
					],
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Blank quotation analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating blank quotation analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate blank quotation analytics: ${error.message}`);
		}
	}

	// HR Analytics Methods
	async generateAttendanceAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating attendance analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `attendance_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Attendance analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh attendance analytics for organization ${organisationId}`);

			// This would integrate with the attendance service
			// For now, return a placeholder structure
			const result = {
				summary: {
					totalEmployees: 0,
					presentToday: 0,
					attendanceRate: 0,
					averageHoursWorked: 0,
					lateArrivals: 0,
					earlyDepartures: 0,
				},
				trends: {
					dailyAttendance: [],
					monthlyAttendance: [],
					punctualityTrends: [],
				},
				chartData: {
					attendanceOverTime: [],
					punctualityDistribution: [],
					departmentBreakdown: [],
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Attendance analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating attendance analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate attendance analytics: ${error.message}`);
		}
	}

	async generateEmployeePerformanceAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating employee performance analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `employee_performance_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Employee performance analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh employee performance analytics for organization ${organisationId}`);

			// This would integrate with the user/task services
			// For now, return a placeholder structure
			const result = {
				summary: {
					totalEmployees: 0,
					averagePerformanceScore: 0,
					topPerformers: [],
					improvementNeeded: [],
					targetAchievementRate: 0,
				},
				metrics: {
					productivityScores: [],
					goalAchievements: [],
					skillAssessments: [],
				},
				chartData: {
					performanceDistribution: [],
					skillsMatrix: [],
					performanceTrends: [],
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Employee performance analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating employee performance analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate employee performance analytics: ${error.message}`);
		}
	}

	async generatePayrollAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating payroll analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `payroll_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Payroll analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh payroll analytics for organization ${organisationId}`);

			// This would integrate with the payroll service
			// For now, return a placeholder structure
			const result = {
				summary: {
					averageSalary: 0,
					totalBenefitsCost: 0,
					payrollGrowth: 0,
					costPerEmployee: 0,
				},
				breakdown: {
					salaryDistribution: [],
					benefitsUtilization: [],
					departmentCosts: [],
				},
				chartData: {
					payrollTrends: [],
					salaryBands: [],
					benefitsCosts: [],
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Payroll analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating payroll analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate payroll analytics: ${error.message}`);
		}
	}

	async generateRecruitmentAnalytics(organisationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Generating recruitment analytics for organization ${organisationId}${branchId ? ` and branch ${branchId}` : ''}`);
		
		try {
			const cacheKey = `recruitment_analytics_${organisationId}${branchId ? `_${branchId}` : ''}`;
			const cached = await this.cacheManager.get(cacheKey);
			
			if (cached) {
				this.logger.log(`Recruitment analytics found in cache: ${cacheKey}`);
				return { ...cached, fromCache: true };
			}

			this.logger.log(`Generating fresh recruitment analytics for organization ${organisationId}`);

			// This would integrate with the recruitment service
			// For now, return a placeholder structure
			const result = {
				summary: {
					totalApplications: 0,
					activePositions: 0,
					averageTimeToHire: 0,
					offerAcceptanceRate: 0,
					recruitmentCost: 0,
				},
				pipeline: {
					candidatesByStage: [],
					interviewScheduled: 0,
					offersSent: 0,
					positionsToFill: 0,
				},
				chartData: {
					hiringTrends: [],
					sourcingChannels: [],
					candidatePipeline: [],
				},
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			this.logger.log(`Recruitment analytics cached successfully: ${cacheKey}`);
			
			return { ...result, fromCache: false };
		} catch (error) {
			this.logger.error(`Error generating recruitment analytics: ${error.message}`, error.stack);
			throw new Error(`Failed to generate recruitment analytics: ${error.message}`);
		}
	}
}
