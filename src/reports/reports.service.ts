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
						this.logger.error(
							`Failed to generate end-of-day report for user ${user.uid}: ${error.message}`,
							error.stack,
						);
						return {
							userId: user.uid,
							success: false,
							reason: error.message,
						};
					}
				}),
			);

			const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
			const failed = results.filter(
				(r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
			).length;

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
		this.logger.log(
			`Handling report generated event - Type: ${payload.reportType}, ID: ${payload.reportId}, User: ${payload.userId}`,
		);

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
				this.logger.error(
					`Failed to send daily report email to ${user.email}: ${emailError.message}`,
					emailError.stack,
				);
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

	/* ---------------------------------------------------------
	 * MAP-DATA helper (live map screen)
	 * -------------------------------------------------------*/
	async generateMapData(params: { organisationId: number; branchId?: number; userId?: number }): Promise<any> {
		this.logger.log(
			`Generating map data for organization ${params.organisationId}${
				params.branchId ? ` and branch ${params.branchId}` : ''
			}${params.userId ? ` and user ${params.userId}` : ''}`,
		);

		const cacheKey = `${this.CACHE_PREFIX}mapdata_org${params.organisationId}_${params.branchId || 'all'}_${params.userId || 'all'}`;

		// Try cache first
		const cached = await this.cacheManager.get(cacheKey);
		if (cached) {
			this.logger.log(`Map data found in cache: ${cacheKey}`);
			return cached;
		}

		try {
			const data = await this.mapDataReportGenerator.generate(params);
			this.logger.log(`Map data generated successfully for organization ${params.organisationId}`);

			// Enhanced summary counts to match new response structure
			const summary = {
				totalWorkers: data.workers.length,
				totalClients: data.clients.length,
				totalCompetitors: data.competitors.length,
				totalQuotations: data.quotations.length,
				totalEvents: data.events?.length || 0,
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
}
