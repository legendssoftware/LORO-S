import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, subDays } from 'date-fns';
import { ReportUtils } from '../utils/report-utils';

import { ReportParamsDto } from '../dto/report-params.dto';
import { User } from '../../user/entities/user.entity';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { Quotation } from '../../shop/entities/quotation.entity';
import { Claim } from '../../claims/entities/claim.entity';
import { TrackingService } from '../../tracking/tracking.service';

@Injectable()
export class OrgActivityReportGenerator {
	private readonly logger = new Logger(OrgActivityReportGenerator.name);

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		@InjectRepository(Lead)
		private leadRepository: Repository<Lead>,
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		@InjectRepository(Claim)
		private claimRepository: Repository<Claim>,
		private trackingService: TrackingService,
	) {}

	async generate(params: ReportParamsDto): Promise<Record<string, any>> {
		const granularity = params.granularity || 'daily';

		// Resolve date range based on report type
		let startDate: Date;
		let endDate: Date;

		if (params.dateRange) {
			startDate = new Date(params.dateRange.start);
			endDate = new Date(params.dateRange.end);
		} else {
			const now = new Date();

			switch (granularity) {
				case 'daily':
					startDate = startOfDay(now);
					endDate = endOfDay(now);
					break;
				case 'weekly':
					startDate = startOfWeek(now, { weekStartsOn: 1 });
					endDate = endOfWeek(now, { weekStartsOn: 1 });
					break;
				case 'end-of-day':
					// End of day report - previous day
					startDate = startOfDay(subDays(now, 1));
					endDate = endOfDay(subDays(now, 1));
					break;
				case 'end-of-week':
					// End of week report - previous week
					startDate = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
					endDate = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
					break;
				default:
					startDate = startOfDay(now);
					endDate = endOfDay(now);
			}
		}

		// Previous period for growth
		const prevStart = granularity === 'weekly' ? subDays(startDate, 7) : subDays(startDate, 1);
		const prevEnd = granularity === 'weekly' ? subDays(endDate, 7) : subDays(endDate, 1);

		try {
			// Load users in org (optionally branch)
			const users = await this.userRepository.find({
				where: {
					organisation: { uid: params.organisationId },
					...(params.branchId ? { branch: { uid: params.branchId } } : {}),
				},
				relations: ['organisation', 'branch'],
			});

			// Collect per-user aggregates in parallel using enhanced ReportUtils
			const perUserData = await Promise.all(
				users.map(async (user) => {
					const [attendanceStats, checkInData, leadData, quotationData, claimData] = await Promise.all([
						ReportUtils.collectAttendanceData(this.attendanceRepository, user.uid, startDate, endDate),
						ReportUtils.collectCheckInData(this.checkInRepository, user.uid, startDate, endDate),
						ReportUtils.collectLeadData(this.leadRepository, user.uid, startDate, endDate),
						ReportUtils.collectQuotationData(this.quotationRepository, user.uid, startDate, endDate),
						ReportUtils.collectClaimData(this.claimRepository, user.uid, startDate, endDate),
					]);

					// Distance travelled (best-effort): use tracking daily aggregator if available
					let distanceKm = 0;
					if (granularity === 'weekly' || granularity === 'end-of-week') {
						// sample once per day (Mon..Sun)
						for (
							let d = new Date(startDate);
							d <= endDate;
							d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
						) {
							const tr = await this.trackingService.getDailyTracking(user.uid, d);
							const km = tr?.data?.tripSummary?.totalDistanceKm || 0;
							distanceKm += km;
						}
					} else {
						const tr = await this.trackingService.getDailyTracking(user.uid, startDate);
						distanceKm = tr?.data?.tripSummary?.totalDistanceKm || 0;
					}

					return {
						uid: user.uid,
						fullName: `${user.name} ${user.surname || ''}`.trim(),
						email: user.email,
						branch: user.branch ? { uid: user.branch.uid, name: user.branch.name } : null,
						visits: checkInData.count,
						hoursWorked: Math.round((attendanceStats.totalWorkMinutes / 60) * 10) / 10,
						claims: claimData.count,
						leads: { 
							new: leadData.newLeadsCount, 
							converted: leadData.convertedCount,
							conversionRate: leadData.conversionRate
						},
						quotations: { 
							count: quotationData.count, 
							revenue: quotationData.totalRevenue 
						},
						leave: { events: 0 }, // TODO: integrate leave module
						calls: { count: 0 }, // TODO: integrate calls source
						distanceKm: Math.round(distanceKm * 10) / 10,
						totalWorkingMinutes: attendanceStats.totalWorkMinutes,
						efficiency: attendanceStats.totalWorkMinutes > 0 ? 
							Math.round((quotationData.totalRevenue / (attendanceStats.totalWorkMinutes / 60)) * 100) / 100 : 0,
					};
				}),
			);

			// Previous period basics for growth
			const [prevQuotations, prevLeadsNew, prevCheckIns] = await Promise.all([
				this.quotationRepository.find({
					where: {
						createdAt: Between(prevStart, prevEnd),
						placedBy: { organisation: { uid: params.organisationId } },
					},
					relations: ['placedBy'],
				}),
				this.leadRepository.find({ where: { createdAt: Between(prevStart, prevEnd) } }),
				this.checkInRepository.find({ where: { checkInTime: Between(prevStart, prevEnd) } }),
			]);

			const totals = perUserData.reduce(
				(acc, u) => {
					acc.visits += u.visits;
					acc.hoursWorked += u.hoursWorked;
					acc.claims += u.claims;
					acc.leadsNew += u.leads.new;
					acc.leadsConverted += u.leads.converted;
					acc.quotationsCount += u.quotations.count;
					acc.quotationRevenue += u.quotations.revenue;
					acc.distanceKm += u.distanceKm;
					return acc;
				},
				{
					visits: 0,
					hoursWorked: 0,
					claims: 0,
					leadsNew: 0,
					leadsConverted: 0,
					quotationsCount: 0,
					quotationRevenue: 0,
					distanceKm: 0,
				},
			);

			// Branch breakdown
			const branchMap = new Map<string, any>();
			perUserData.forEach((u) => {
				const key = u.branch?.uid ? String(u.branch.uid) : 'unassigned';
				if (!branchMap.has(key)) {
					branchMap.set(key, {
						uid: u.branch?.uid || 0,
						name: u.branch?.name || 'Unassigned',
						totalEmployees: 0,
						presentEmployees: 0, // best-effort; requires attendance presence check if needed
						averageWorkingHours: 0,
						users: [],
					});
				}
				const b = branchMap.get(key);
				b.totalEmployees += 1;
				b.users.push({
					uid: u.uid,
					fullName: u.fullName,
					totalWorkingMinutes: u.totalWorkingMinutes,
					efficiency:
						u.hoursWorked > 0 ? Math.min(100, u.quotations.revenue / (u.hoursWorked || 1) / 100) : null,
					role: undefined,
				});
			});
			const branchBreakdown = Array.from(branchMap.values()).map((b) => ({
				...b,
				averageWorkingHours:
					b.users.length > 0
						? Math.round(
								(b.users.reduce((s, u) => s + (u.totalWorkingMinutes || 0), 0) / b.users.length / 60) *
									10,
						  ) / 10
						: 0,
			}));

			const response = {
				metadata: {
					reportType: 'org_activity',
					organisationId: params.organisationId,
					branchId: params.branchId || null,
					granularity,
					dateRange: { start: startDate, end: endDate },
					generatedAt: new Date(),
				},
				summary: {
					totalEmployees: users.length,
					visits: totals.visits,
					hoursWorked: Math.round(totals.hoursWorked * 10) / 10,
					claims: totals.claims,
					leads: {
						new: totals.leadsNew,
						converted: totals.leadsConverted,
						conversionRate:
							totals.leadsNew > 0 ? Math.round((totals.leadsConverted / totals.leadsNew) * 1000) / 10 : 0,
					},
					quotations: { count: totals.quotationsCount, revenue: totals.quotationRevenue },
					leave: { events: 0 },
					calls: { count: 0 },
					distanceKm: Math.round(totals.distanceKm * 10) / 10,
					growth: {
						visits: ReportUtils.calculateGrowth(totals.visits, prevCheckIns.length),
						quotations: ReportUtils.calculateGrowth(totals.quotationsCount, prevQuotations.length),
						leads: ReportUtils.calculateGrowth(totals.leadsNew, prevLeadsNew.length),
					},
				},
				branchBreakdown,
				users: perUserData,
				// Enhanced insights using ReportUtils
				insights: {
					...ReportUtils.calculateTeamMetrics(perUserData),
					performance: ReportUtils.generatePerformanceInsights({
						hoursWorked: totals.hoursWorked,
						quotationsRevenue: totals.quotationRevenue,
						leadsNew: totals.leadsNew,
						leadsConverted: totals.leadsConverted,
						targetSalesAmount: 10000, // This could be dynamic based on org targets
					}),
					recommendations: this.generateRecommendations(totals, granularity, perUserData),
				},
				// Enhanced email data structure for template consumption
				emailData: ReportUtils.generateEmailReportData(
					'org_activity',
					granularity,
					startDate,
					endDate,
					{
						summary: {
							totalEmployees: users.length,
							activeEmployees: perUserData.filter(u => u.hoursWorked > 0).length,
							...totals,
						},
						growth: {
							visits: ReportUtils.calculateGrowth(totals.visits, prevCheckIns.length),
							quotations: ReportUtils.calculateGrowth(totals.quotationsCount, prevQuotations.length),
							leads: ReportUtils.calculateGrowth(totals.leadsNew, prevLeadsNew.length),
						},
						branches: branchBreakdown,
						topPerformers: perUserData
							.filter((u) => u.hoursWorked > 0)
							.sort((a, b) => (b.quotations.revenue || 0) - (a.quotations.revenue || 0))
							.slice(0, 5)
							.map(u => ({
								name: u.fullName,
								email: u.email,
								revenue: u.quotations.revenue,
								hours: u.hoursWorked,
								efficiency: u.efficiency,
							})),
						alertUsers: perUserData
							.filter((u) => u.hoursWorked < (granularity === 'weekly' ? 10 : 1))
							.slice(0, 5)
							.map(u => ({
								name: u.fullName,
								email: u.email,
								hours: u.hoursWorked,
								lastActivity: 'N/A', // Could be enhanced
							})),
						organizationName: users[0]?.organisation?.name || 'Organization',
						reportPeriod: ReportUtils.formatDateRange(startDate, endDate, granularity),
					},
					ReportUtils.generatePerformanceInsights({
						hoursWorked: totals.hoursWorked,
						quotationsRevenue: totals.quotationRevenue,
						leadsNew: totals.leadsNew,
						leadsConverted: totals.leadsConverted,
						targetSalesAmount: 10000,
					})
				),
			};

			return response;
		} catch (error) {
			this.logger.error(`Error generating org activity report: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Generate actionable recommendations based on report data
	 */
	private generateRecommendations(totals: any, granularity: string, userData: any[]): string[] {
		const recommendations: string[] = [];
		const activeUsers = userData.filter(u => u.hoursWorked > 0).length;
		const totalUsers = userData.length;

		// Low activity recommendations
		if (activeUsers / totalUsers < 0.8) {
			recommendations.push('Consider team engagement initiatives - less than 80% of staff are active');
		}

		// Revenue performance
		const avgRevenue = userData.length > 0 ? 
			userData.reduce((sum, u) => sum + (u.quotations?.revenue || 0), 0) / userData.length : 0;
		
		if (avgRevenue < 1000) {
			recommendations.push('Focus on sales training and quotation generation strategies');
		}

		// Lead conversion
		const totalLeadsNew = userData.reduce((sum, u) => sum + (u.leads?.new || 0), 0);
		const totalLeadsConverted = userData.reduce((sum, u) => sum + (u.leads?.converted || 0), 0);
		const conversionRate = totalLeadsNew > 0 ? (totalLeadsConverted / totalLeadsNew) * 100 : 0;

		if (conversionRate < 20) {
			recommendations.push('Improve lead qualification and follow-up processes - conversion rate below 20%');
		}

		// Work hours balance
		const avgHours = userData.length > 0 ? 
			userData.reduce((sum, u) => sum + (u.hoursWorked || 0), 0) / userData.length : 0;
		
		if (granularity === 'weekly' && avgHours > 50) {
			recommendations.push('Monitor work-life balance - average weekly hours exceeding 50');
		} else if (granularity === 'daily' && avgHours > 10) {
			recommendations.push('Monitor work-life balance - average daily hours exceeding 10');
		}

		// Distance and efficiency
		const totalDistance = userData.reduce((sum, u) => sum + (u.distanceKm || 0), 0);
		if (totalDistance > 1000 && granularity === 'weekly') {
			recommendations.push('Consider route optimization to reduce travel distance and costs');
		}

		// Add time-specific recommendations
		if (granularity === 'end-of-day') {
			recommendations.push('Review daily achievements and prepare tomorrow\'s priorities');
		} else if (granularity === 'end-of-week') {
			recommendations.push('Analyze weekly performance trends and plan next week\'s focus areas');
		}

		return recommendations;
	}

}
