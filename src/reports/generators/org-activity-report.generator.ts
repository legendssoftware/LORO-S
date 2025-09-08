import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, subDays } from 'date-fns';

import { ReportParamsDto } from '../dto/report-params.dto';
import { User } from '../../user/entities/user.entity';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { LeadStatus } from '../../lib/enums/lead.enums';
import { Quotation } from '../../shop/entities/quotation.entity';
import { Claim } from '../../claims/entities/claim.entity';
import { AttendanceService } from '../../attendance/attendance.service';
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
		private attendanceService: AttendanceService,
		private trackingService: TrackingService,
	) {}

	private calculateGrowth(current: number, previous: number): string {
		if (previous === 0) {
			return current > 0 ? '+100%' : '0%';
		}
		const growth = ((current - previous) / previous) * 100;
		const sign = growth >= 0 ? '+' : '';
		return `${sign}${Math.round(growth * 10) / 10}%`;
	}

	async generate(params: ReportParamsDto): Promise<Record<string, any>> {
		const granularity = params.granularity || 'daily';

		// Resolve date range
		let startDate = params.dateRange?.start ? new Date(params.dateRange.start) : new Date();
		let endDate = params.dateRange?.end ? new Date(params.dateRange.end) : new Date();

		if (!params.dateRange) {
			if (granularity === 'weekly') {
				startDate = startOfWeek(new Date(), { weekStartsOn: 1 });
				endDate = endOfWeek(new Date(), { weekStartsOn: 1 });
			} else {
				startDate = startOfDay(new Date());
				endDate = endOfDay(new Date());
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

			// Collect per-user aggregates in parallel
			const perUserData = await Promise.all(
				users.map(async (user) => {
					const [attendanceStats, checkIns, leadsNew, leadsConverted, quotations, claims] = await Promise.all(
						[
							this.collectAttendance(user.uid, startDate, endDate),
							this.checkInRepository.find({
								where: { owner: { uid: user.uid }, checkInTime: Between(startDate, endDate) },
								relations: ['client'],
							}),
							this.leadRepository.find({
								where: { ownerUid: user.uid, createdAt: Between(startDate, endDate) },
							}),
							this.leadRepository.find({
								where: {
									ownerUid: user.uid,
									status: LeadStatus.CONVERTED,
									updatedAt: Between(startDate, endDate),
								},
							}),
							this.quotationRepository.find({
								where: { placedBy: { uid: user.uid }, createdAt: Between(startDate, endDate) },
								relations: ['client'],
							}),
							this.claimRepository.find({
								where: { owner: { uid: user.uid }, createdAt: Between(startDate, endDate) },
							}),
						],
					);

					// Distance travelled (best-effort): use tracking daily aggregator if available
					let distanceKm = 0;
					if (granularity === 'weekly') {
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

					const quotationRevenue = quotations.reduce((sum, q) => {
						const amount =
							typeof q.totalAmount === 'string' ? parseFloat(q.totalAmount) : q.totalAmount || 0;
						return sum + (Number.isNaN(amount) ? 0 : amount);
					}, 0);

					return {
						uid: user.uid,
						fullName: `${user.name} ${user.surname || ''}`.trim(),
						branch: user.branch ? { uid: user.branch.uid, name: user.branch.name } : null,
						visits: checkIns.length,
						hoursWorked: Math.round((attendanceStats.totalWorkMinutes / 60) * 10) / 10,
						claims: claims.length,
						leads: { new: leadsNew.length, converted: leadsConverted.length },
						quotations: { count: quotations.length, revenue: quotationRevenue },
						leave: { events: 0 }, // TODO: integrate leave module
						calls: { count: 0 }, // TODO: integrate calls source
						distanceKm: Math.round(distanceKm * 10) / 10,
						totalWorkingMinutes: attendanceStats.totalWorkMinutes,
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
						visits: this.calculateGrowth(totals.visits, prevCheckIns.length),
						quotations: this.calculateGrowth(totals.quotationsCount, prevQuotations.length),
						leads: this.calculateGrowth(totals.leadsNew, prevLeadsNew.length),
					},
				},
				branchBreakdown,
				users: perUserData,
				insights: {
					topPerformers: perUserData
						.filter((u) => u.hoursWorked > 0)
						.sort((a, b) => (b.quotations.revenue || 0) - (a.quotations.revenue || 0))
						.slice(0, 10),
					lowActivityUsers: perUserData.filter((u) => u.hoursWorked < (granularity === 'weekly' ? 10 : 1)),
				},
				emailData: {
					title: granularity === 'weekly' ? 'Weekly Organisation Report' : 'Daily Organisation Report',
					period: granularity,
					date:
						granularity === 'weekly'
							? `${format(startDate, 'yyyy-MM-dd')} - ${format(endDate, 'yyyy-MM-dd')}`
							: format(startDate, 'yyyy-MM-dd'),
					summaryLabel: granularity === 'weekly' ? 'This Week' : 'Today',
					summary: {
						...(this as any).summary,
					},
					metrics: {
						visits: totals.visits,
						hoursWorked: Math.round(totals.hoursWorked * 10) / 10,
						claims: totals.claims,
						leadsNew: totals.leadsNew,
						leadsConverted: totals.leadsConverted,
						quotations: totals.quotationsCount,
						revenue: totals.quotationRevenue,
						leave: 0,
						calls: 0,
						distanceKm: Math.round(totals.distanceKm * 10) / 10,
					},
					branches: branchBreakdown,
					users: perUserData,
					dashboardUrl:
						process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN || 'https://loro.co.za',
				},
			};

			return response;
		} catch (error) {
			this.logger.error(`Error generating org activity report: ${error.message}`, error.stack);
			throw error;
		}
	}

	private async collectAttendance(userId: number, startDate: Date, endDate: Date) {
		// Use AttendanceService daily stats summation as best-effort
		// For performance, also query raw records to get total minutes if needed
		const records = await this.attendanceRepository.find({
			where: { owner: { uid: userId }, checkIn: Between(startDate, endDate) },
			order: { checkIn: 'ASC' },
		});

		// If AttendanceService exposes a weekly method, prefer it; otherwise compute
		const totalWorkMinutes = records.reduce((sum, r) => {
			const start = r.checkIn ? new Date(r.checkIn).getTime() : 0;
			const end = r.checkOut ? new Date(r.checkOut).getTime() : start;
			const delta = Math.max(0, Math.floor((end - start) / (1000 * 60)));
			return sum + delta;
		}, 0);

		return { totalWorkMinutes };
	}
}
