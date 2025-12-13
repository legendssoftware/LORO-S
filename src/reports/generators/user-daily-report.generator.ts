import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, Not, Repository, LessThanOrEqual, IsNull } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { Journal } from '../../journal/entities/journal.entity';
import { Client } from '../../clients/entities/client.entity';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { TaskStatus, TaskPriority } from '../../lib/enums/task.enums';
import { LeadStatus } from '../../lib/enums/lead.enums';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { startOfDay, endOfDay, format, differenceInMinutes, subDays } from 'date-fns';
import { AttendanceService } from '../../attendance/attendance.service';
import { ReportParamsDto } from '../dto/report-params.dto';
import { Quotation } from '../../shop/entities/quotation.entity';
import { TrackingService } from '../../tracking/tracking.service';
import { Claim } from '../../claims/entities/claim.entity';
import { UserRewards } from '../../rewards/entities/user-rewards.entity';
import { XPTransaction } from '../../rewards/entities/xp-transaction.entity';
import { UserTarget } from '../../user/entities/user-target.entity';
import { OrganisationHoursService } from '../../organisation/services/organisation-hours.service';
import { ReportUtils } from '../utils/report-utils';
import { TimezoneUtil } from '../../lib/utils/timezone.util';
import { OrganizationHoursService } from '../../attendance/services/organization.hours.service';

@Injectable()
export class UserDailyReportGenerator {
	private readonly logger = new Logger(UserDailyReportGenerator.name);

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		@InjectRepository(Lead)
		private leadRepository: Repository<Lead>,
		@InjectRepository(Journal)
		private journalRepository: Repository<Journal>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		@InjectRepository(Claim)
		private claimRepository: Repository<Claim>,
		@InjectRepository(UserRewards)
		private userRewardsRepository: Repository<UserRewards>,
		@InjectRepository(XPTransaction)
		private xpTransactionRepository: Repository<XPTransaction>,
		@InjectRepository(UserTarget)
		private userTargetRepository: Repository<UserTarget>,
		@Inject(forwardRef(() => AttendanceService))
		private attendanceService: AttendanceService,
		private trackingService: TrackingService,
		private organisationHoursService: OrganisationHoursService,
		private organizationHoursService: OrganizationHoursService,
	) {}

	// ======================================================
	// TIMEZONE HELPER METHODS
	// ======================================================

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
	 * Format time in organization timezone for reports
	 */
	private async formatTimeInOrganizationTimezone(date: Date, organizationId?: number, format: string = 'h:mm a'): Promise<string> {
		if (!date) return 'N/A';
		
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.formatInOrganizationTime(date, format, timezone);
	}

	/**
	 * Format date in organization timezone for reports
	 */
	private async formatDateInOrganizationTimezone(date: Date, organizationId?: number, format: string = 'yyyy-MM-dd'): Promise<string> {
		if (!date) return 'N/A';
		
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.formatInOrganizationTime(date, format, timezone);
	}

	/**
	 * Convert server time to organization time
	 */
	private async toOrganizationTime(serverDate: Date, organizationId?: number): Promise<Date> {
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.toOrganizationTime(serverDate, timezone);
	}

	private parseGrowthPercentage(growthStr: string): number {
		if (!growthStr) return 0;
		return parseFloat(growthStr.replace(/[+%]/g, '')) || 0;
	}

	/**
	 * Check if the organization is open on the given date
	 */
	private async isOrganizationOpen(user: any, date: Date): Promise<boolean> {
		try {
			if (!user.organisation || !user.organisation.ref) {
				this.logger.warn(`User ${user.uid} has no organization reference`);
				return true; // Default to true if no organization hours are set
			}

			const orgHours = await this.organisationHoursService.findDefault(user.organisation.ref);
			
			if (!orgHours) {
				this.logger.warn(`No organization hours found for org ${user.organisation.ref}`);
				return true; // Default to true if no organization hours are set
			}

			const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
			const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
			const dayName = dayNames[dayOfWeek];

			// Check if the organization is open on this day
			const isOpen = orgHours[`${dayName}Open`] === true;
			const startTime = orgHours[`${dayName}StartTime`];
			const endTime = orgHours[`${dayName}EndTime`];

			// If the day is marked as open and has valid start/end times, consider it a working day
			return isOpen && startTime && endTime;
		} catch (error) {
			this.logger.error(`Error checking organization hours: ${error.message}`);
			return true; // Default to true on error to avoid blocking reports
		}
	}

	async generate(params: ReportParamsDto): Promise<Record<string, any>> {
		const { userId, dateRange, triggeredByActivity, attendanceId } = params.filters || {};

		if (!userId) {
			throw new Error('User ID is required for generating a daily user report');
		}

		let startDate = new Date();
		let endDate = new Date();

		if (dateRange && dateRange.start && dateRange.end) {
			startDate = new Date(dateRange.start);
			endDate = new Date(dateRange.end);
		} else {
			// Default to today
			startDate = startOfDay(new Date());
			endDate = endOfDay(new Date());
		}

		// Dates for previous period (for growth calculation)
		const previousStartDate = startOfDay(subDays(startDate, 1));
		const previousEndDate = endOfDay(subDays(startDate, 1));

		try {
			// Get user data with organization relation
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user) {
				throw new Error(`User with ID ${userId} not found`);
			}

			const organizationId = user?.organisation?.uid;

			// Check if organization is open on this date (only for scheduled reports, not activity-triggered ones)
			const isWorkingDay = await this.isOrganizationOpen(user, startDate);
			
			// Skip organization hours check if this report was triggered by user activity (like checking out)
			// If user worked and checked out, they deserve their end-of-day report regardless of "official" hours
			if (!isWorkingDay && !triggeredByActivity) {
				const formattedDate = await this.formatDateInOrganizationTimezone(startDate, organizationId, 'yyyy-MM-dd');
				this.logger.log(`Skipping report generation for user ${userId} on ${formattedDate} - Organization is closed (scheduled report)`);
				return {
					metadata: {
						reportType: 'user_daily',
						userId,
						userName: `${user.name} ${user.surname || ''}`.trim(),
						date: formattedDate,
						generatedAt: await this.formatDateInOrganizationTimezone(new Date(), organizationId, 'yyyy-MM-dd HH:mm:ss'),
						isWorkingDay: false,
						skipReason: 'Organization closed on this date (scheduled report)',
					},
					summary: null,
					details: null,
					emailData: null,
				};
			}

			// If triggered by activity, log that we're generating despite organization being closed
			if (!isWorkingDay && triggeredByActivity) {
				const formattedDate = await this.formatDateInOrganizationTimezone(startDate, organizationId, 'yyyy-MM-dd');
				this.logger.log(`Generating activity-triggered report for user ${userId} on ${formattedDate} despite organization being closed - user was active`);
			}

			// Collect all data in parallel for efficiency
			const [
				attendanceData,
				taskMetrics,
				leadMetrics,
				journalEntries,
				clientInteractions,
				locationData,
				quotationData,
				claimData,
				previousQuotationData,
				previousClientData,
				rewardsData,
				targetsData,
				// New enhanced data collections
				performanceAnalytics,
				productivityInsights,
				weeklyComparison,
				predictiveAnalytics,
				wellnessMetrics,
			] = await Promise.all([
				this.collectAttendanceData(userId, startDate, endDate, attendanceId),
				this.collectTaskMetrics(userId, startDate, endDate),
				this.collectLeadMetrics(userId, startDate, endDate),
				this.collectJournalData(userId, startDate, endDate),
				this.collectClientData(userId, startDate, endDate),
				this.collectLocationData(userId, startDate, endDate),
				this.collectQuotationData(userId, startDate, endDate),
				this.collectClaimData(userId, startDate, endDate),
				this.collectQuotationData(userId, previousStartDate, previousEndDate),
				this.collectClientData(userId, previousStartDate, previousEndDate),
				this.collectRewardsData(userId, startDate, endDate),
				this.collectTargetsData(userId),
				// New enhanced data collection methods
				this.collectPerformanceAnalytics(userId, startDate, endDate),
				this.collectProductivityInsights(userId, startDate, endDate),
				this.collectWeeklyComparison(userId, startDate),
				this.generatePredictiveAnalytics(userId, startDate, endDate),
				this.collectWellnessMetrics(userId, startDate, endDate),
			]);

			// Format the date for display in organization timezone
			const formattedDate = await this.formatDateInOrganizationTimezone(startDate, organizationId, 'yyyy-MM-dd');

			// Build the report data structure

			const response = {
				metadata: {
					reportType: 'user_daily',
					userId,
					userName: `${user.name} ${user.surname || ''}`.trim(),
					date: formattedDate,
					generatedAt: await this.formatDateInOrganizationTimezone(new Date(), organizationId, 'yyyy-MM-dd HH:mm:ss'),
					isWorkingDay: true,
					organizationName: user.organisation?.name || 'Unknown Organization',
					organizationId: organizationId,
					timezone: await this.getOrganizationTimezone(organizationId),
				},
				summary: {
					hoursWorked: Math.round((attendanceData.totalWorkMinutes / 60) * 10) / 10,
					tasksCompleted: taskMetrics.completedCount,
					newLeads: leadMetrics.newLeadsCount,
					clientInteractions: clientInteractions.totalInteractions,
					totalEntries: journalEntries.count,
					totalQuotations: quotationData.totalQuotations,
					totalRevenue: quotationData.totalRevenueFormatted,
					totalClaims: claimData.count,
					xpEarned: rewardsData.dailyXPEarned,
					currentLevel: rewardsData.currentLevel,
					currentRank: rewardsData.currentRank,
				},
				details: {
					attendance: attendanceData,
					tasks: taskMetrics,
					leads: leadMetrics,
					journal: journalEntries,
					clients: clientInteractions,
					location: locationData,
					quotations: quotationData,
					claims: claimData,
					rewards: rewardsData,
					targets: targetsData,
					// Enhanced analytics and insights
					performance: performanceAnalytics,
					productivity: productivityInsights,
					weeklyComparison: weeklyComparison,
					predictions: predictiveAnalytics,
					wellness: wellnessMetrics,
				},
				// Format data specifically for email template
				emailData: {
					name: user.name,
					date: formattedDate,
					metrics: {
						attendance: {
							status: attendanceData.status,
							startTime: attendanceData.firstCheckIn,
							endTime: attendanceData.lastCheckOut,
							totalHours: Math.round((attendanceData.totalWorkMinutes / 60) * 100) / 100, // Round to 2 decimal places
							duration: this.formatDuration(attendanceData.totalWorkMinutes),
							overtime: attendanceData.overtime || '0h 0m',
							checkInLocation: attendanceData.firstCheckInLocation,
							checkOutLocation: attendanceData.lastCheckOutLocation,
						},
						totalQuotations: quotationData.totalQuotations,
						totalRevenue: quotationData.totalRevenueFormatted,
						newCustomers: clientInteractions.newClients,
						quotationGrowth: ReportUtils.calculateGrowth(
							quotationData.totalQuotations,
							previousQuotationData.totalQuotations,
						),
						revenueGrowth: ReportUtils.calculateGrowth(
							quotationData.totalRevenue,
							previousQuotationData.totalRevenue,
						),
						customerGrowth: ReportUtils.calculateGrowth(
							clientInteractions.newClients,
							previousClientData.newClients,
						),
						userSpecific: {
							todayLeads: leadMetrics.newLeadsCount,
							todayClaims: claimData.count,
							todayTasks: taskMetrics.completedCount,
							todayQuotations: quotationData.totalQuotations,
							hoursWorked: Math.round((attendanceData.totalWorkMinutes / 60) * 10) / 10,
							xpEarned: rewardsData.dailyXPEarned,
							currentLevel: rewardsData.currentLevel,
							currentRank: rewardsData.currentRank,
						},
						targets: targetsData,
						// Enhanced analytics for email template
						performance: {
							overallScore: performanceAnalytics.overallScore,
							taskEfficiency: performanceAnalytics.taskEfficiency,
							leadConversionRate: performanceAnalytics.leadConversionRate,
							revenuePerHour: performanceAnalytics.revenuePerHour,
							strengths: performanceAnalytics.strengths,
							improvementAreas: performanceAnalytics.improvementAreas,
						},
						productivity: {
							score: productivityInsights.productivityScore,
							peakHour: productivityInsights.peakProductivityHour,
							focusTime: productivityInsights.averageFocusTime,
							recommendations: productivityInsights.recommendations,
							workPatterns: productivityInsights.workPatterns,
						},
						weeklyComparison: {
							trend: weeklyComparison.trend,
							changes: weeklyComparison.changes,
							current: weeklyComparison.current,
							previous: weeklyComparison.previous,
						},
						predictions: {
							targetAchievementProbability: predictiveAnalytics.targetAchievementProbability,
							projectedCompletion: predictiveAnalytics.projectedCompletion,
							recommendations: predictiveAnalytics.recommendations,
							riskFactors: predictiveAnalytics.riskFactors,
						},
						wellness: {
							score: wellnessMetrics.wellnessScore,
							workLifeBalance: wellnessMetrics.workLifeBalance,
							stressLevel: wellnessMetrics.stressLevel,
							recommendations: wellnessMetrics.recommendations,
						},
					},
					tracking: locationData.trackingData,
					dashboardUrl: process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN || 'https://dashboard.loro.co.za',
				},
			};

			return response;
		} catch (error) {
			throw new Error(`Failed to generate daily report: ${error.message}`);
		}
	}

	private async collectAttendanceData(userId: number, startDate: Date, endDate: Date, triggeringAttendanceId?: number) {
		// Get user with organization info for timezone formatting
		const user = await this.userRepository.findOne({
			where: { uid: userId },
			relations: ['organisation'],
		});

		const organizationId = user?.organisation?.uid;

		// Get daily stats from attendance service
		const dailyStats = await this.attendanceService.getDailyStats(userId, format(startDate, 'yyyy-MM-dd'));

		// Get all attendance records for the day
		const attendanceRecords = await this.attendanceRepository.find({
			where: {
				owner: { uid: userId },
				checkIn: MoreThanOrEqual(startDate),
				checkOut: LessThanOrEqual(endDate),
			},
			order: { checkIn: 'ASC' },
		});

		// Get the first check-in and last check-out
		const firstRecord = attendanceRecords[0];
		const lastRecord = attendanceRecords[attendanceRecords.length - 1];

		// Identify the triggering attendance record if provided
		let triggeringRecord = null;
		if (triggeringAttendanceId) {
			triggeringRecord = attendanceRecords.find(record => record.uid === triggeringAttendanceId);
			if (triggeringRecord) {
				this.logger.debug(`Found triggering attendance record ${triggeringAttendanceId} for report generation`);
			} else {
				this.logger.warn(`Triggering attendance record ${triggeringAttendanceId} not found in today's records`);
			}
		}

		// Find active shift
		const activeShift = await this.attendanceRepository.findOne({
			where: {
				owner: { uid: userId },
				status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
				checkIn: MoreThanOrEqual(startDate),
				checkOut: IsNull(),
			},
		});

		// Calculate total work minutes from milliseconds
		const totalWorkMinutes = Math.floor(dailyStats.dailyWorkTime / (1000 * 60));
		const totalBreakMinutes = Math.floor(dailyStats.dailyBreakTime / (1000 * 60));

		// Calculate total overtime from all attendance records
		let totalOvertimeMinutes = 0;
		let totalOvertimeDuration = '0h 0m';

		for (const record of attendanceRecords) {
			if (record.overtime && record.overtime !== '0h 0m') {
				// Parse overtime string (e.g., "2h 30m") and add to total
				const overtimeMinutes = this.parseTimeString(record.overtime);
				totalOvertimeMinutes += overtimeMinutes;
			}
		}

		if (totalOvertimeMinutes > 0) {
			const hours = Math.floor(totalOvertimeMinutes / 60);
			const minutes = totalOvertimeMinutes % 60;
			totalOvertimeDuration = `${hours}h ${minutes}m`;
		}

		// Format locations for reporting
		let firstCheckInLocation = null;
		if (firstRecord?.checkInLatitude && firstRecord?.checkInLongitude) {
			firstCheckInLocation = {
				latitude: parseFloat(String(firstRecord.checkInLatitude)),
				longitude: parseFloat(String(firstRecord.checkInLongitude)),
				notes: firstRecord.checkInNotes || '',
			};
		}

		let lastCheckOutLocation = null;
		if (lastRecord?.checkOutLatitude && lastRecord?.checkOutLongitude) {
			lastCheckOutLocation = {
				latitude: parseFloat(String(lastRecord.checkOutLatitude)),
				longitude: parseFloat(String(lastRecord.checkOutLongitude)),
				notes: lastRecord.checkOutNotes || '',
			};
		}

		return {
			status: activeShift ? activeShift.status : lastRecord ? lastRecord.status : 'NOT_PRESENT',
			firstCheckIn: firstRecord?.checkIn ? await this.formatTimeInOrganizationTimezone(new Date(firstRecord.checkIn), organizationId, 'HH:mm:ss') : null,
			lastCheckOut: lastRecord?.checkOut ? await this.formatTimeInOrganizationTimezone(new Date(lastRecord.checkOut), organizationId, 'HH:mm:ss') : null,
			totalWorkMinutes,
			totalBreakMinutes,
			totalOvertimeMinutes,
			overtime: totalOvertimeDuration,
			totalShifts: attendanceRecords.length,
			firstCheckInLocation,
			lastCheckOutLocation,
			onBreak: activeShift?.status === AttendanceStatus.ON_BREAK,
			breakDetails: await this.formatBreakDetails(attendanceRecords, organizationId),
			isCurrentlyWorking: !!activeShift,
			// Include information about the triggering attendance record
			triggeringRecord: triggeringRecord ? {
				uid: triggeringRecord.uid,
				checkIn: triggeringRecord.checkIn ? await this.formatTimeInOrganizationTimezone(new Date(triggeringRecord.checkIn), organizationId, 'HH:mm:ss') : null,
				checkOut: triggeringRecord.checkOut ? await this.formatTimeInOrganizationTimezone(new Date(triggeringRecord.checkOut), organizationId, 'HH:mm:ss') : null,
				duration: triggeringRecord.duration,
				overtime: triggeringRecord.overtime,
				status: triggeringRecord.status,
			} : null,
		};
	}

	private parseTimeString(timeString: string): number {
		if (!timeString || timeString === '0h 0m') return 0;
		
		const hoursMatch = timeString.match(/(\d+)h/);
		const minutesMatch = timeString.match(/(\d+)m/);
		
		const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
		const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
		
		return hours * 60 + minutes;
	}

	private async formatBreakDetails(attendanceRecords: Attendance[], organizationId?: number) {
		let breakDetails = [];

		for (const record of attendanceRecords) {
			if (record.breakDetails && record.breakDetails.length > 0) {
				const formattedBreaks = await Promise.all(
					record.breakDetails
						.map(async (breakItem) => {
							if (!breakItem.startTime || !breakItem.endTime) return null;

							const startTime = new Date(breakItem.startTime);
							const endTime = breakItem.endTime ? new Date(breakItem.endTime) : null;

							return {
								startTime: await this.formatTimeInOrganizationTimezone(startTime, organizationId, 'HH:mm:ss'),
								endTime: endTime ? await this.formatTimeInOrganizationTimezone(endTime, organizationId, 'HH:mm:ss') : null,
								duration:
									breakItem.duration ||
									(endTime ? this.formatDuration(differenceInMinutes(endTime, startTime)) : null),
								notes: breakItem.notes || '',
							};
						})
				);

				const validBreaks = formattedBreaks.filter(Boolean);
				breakDetails = [...breakDetails, ...validBreaks];
			}
		}

		return breakDetails;
	}

	private async collectTaskMetrics(userId: number, startDate: Date, endDate: Date) {
		// Tasks completed today - use QueryBuilder for JSON array field
		const completedTasksQuery = this.taskRepository
			.createQueryBuilder('task')
			.where('task.status = :status', { status: TaskStatus.COMPLETED })
			.andWhere('task.completionDate BETWEEN :startDate AND :endDate', { startDate, endDate })
			.andWhere('task.assignees @> CAST(:userIdJson AS jsonb)', { 
				userIdJson: JSON.stringify([{ uid: userId }])
			});
		const completedTasks = await completedTasksQuery.getMany();

		// Tasks created today
		const createdTasks = await this.taskRepository.find({
			where: {
				creator: { uid: userId },
				createdAt: Between(startDate, endDate),
			},
		});

		// Tasks due tomorrow
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(0, 0, 0, 0);
		const dayAfterTomorrow = new Date(tomorrow);
		dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

		const dueTomorrowQuery = this.taskRepository
			.createQueryBuilder('task')
			.where('task.deadline BETWEEN :tomorrow AND :dayAfterTomorrow', { tomorrow, dayAfterTomorrow })
			.andWhere('task.assignees @> CAST(:userIdJson AS jsonb)', { 
				userIdJson: JSON.stringify([{ uid: userId }])
			})
			.andWhere('task.status NOT IN (:...statuses)', { 
				statuses: [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
			});
		const dueTomorrow = await dueTomorrowQuery.getMany();

		// Overdue tasks - use QueryBuilder for JSON array field
		const overdueTasksQuery = this.taskRepository
			.createQueryBuilder('task')
			.where('task.status = :status', { status: TaskStatus.OVERDUE })
			.andWhere('task.assignees @> CAST(:userIdJson AS jsonb)', { 
				userIdJson: JSON.stringify([{ uid: userId }])
			});
		const overdueTasks = await overdueTasksQuery.getMany();

		// Map tasks to simplified format
		const completedTasksList = completedTasks.map((task) => ({
			id: task.uid,
			title: task.title,
			description: this.truncateText(task.description, 100),
			priority: task.priority,
			completedAt: task.completionDate ? format(new Date(task.completionDate), 'HH:mm:ss') : null,
		}));

		const dueTomorrowList = dueTomorrow.map((task) => ({
			id: task.uid,
			title: task.title,
			description: this.truncateText(task.description, 100),
			priority: task.priority,
			deadline: task.deadline ? format(new Date(task.deadline), 'yyyy-MM-dd HH:mm') : null,
		}));

		const overdueList = overdueTasks.map((task) => ({
			id: task.uid,
			title: task.title,
			description: this.truncateText(task.description, 100),
			priority: task.priority,
			deadline: task.deadline ? format(new Date(task.deadline), 'yyyy-MM-dd HH:mm') : null,
			daysOverdue: task.deadline
				? Math.floor((new Date().getTime() - new Date(task.deadline).getTime()) / (1000 * 3600 * 24))
				: 0,
		}));

		// Calculate completion rate
		const totalAssignedTasks = completedTasks.length + overdueTasks.length;
		const completionRate = totalAssignedTasks > 0 ? (completedTasks.length / totalAssignedTasks) * 100 : 0;

		return {
			completedCount: completedTasks.length,
			createdCount: createdTasks.length,
			dueTomorrowCount: dueTomorrow.length,
			overdueCount: overdueTasks.length,
			completionRate: Math.round(completionRate * 10) / 10,
			completedTasks: completedTasksList,
			dueTomorrowTasks: dueTomorrowList,
			overdueTasks: overdueList,
			priorityBreakdown: this.calculatePriorityBreakdown([...completedTasks, ...dueTomorrow, ...overdueTasks]),
		};
	}

	private calculatePriorityBreakdown(tasks: Task[]) {
		const counts = {
			[TaskPriority.LOW]: 0,
			[TaskPriority.MEDIUM]: 0,
			[TaskPriority.HIGH]: 0,
			[TaskPriority.URGENT]: 0,
		};

		tasks.forEach((task) => {
			if (counts.hasOwnProperty(task.priority)) {
				counts[task.priority]++;
			}
		});

		return counts;
	}

	private async collectLeadMetrics(userId: number, startDate: Date, endDate: Date) {
		// New leads captured today
		const newLeads = await this.leadRepository.find({
			where: {
				ownerUid: userId,
				createdAt: Between(startDate, endDate),
			},
		});

		// Leads converted today
		const convertedLeads = await this.leadRepository.find({
			where: {
				ownerUid: userId,
				status: LeadStatus.CONVERTED,
				updatedAt: Between(startDate, endDate),
			},
		});

		// Format leads for report
		const newLeadsList = newLeads.map((lead) => ({
			id: lead.uid,
			name: lead.name || 'Unnamed Lead',
			email: lead.email || 'N/A',
			phone: lead.phone || 'N/A',
			createdAt: format(new Date(lead.createdAt), 'HH:mm:ss'),
			hasImage: !!lead.image,
			hasLocation: !!(lead.latitude && lead.longitude),
		}));

		const convertedLeadsList = convertedLeads.map((lead) => ({
			id: lead.uid,
			name: lead.name || 'Unnamed Lead',
			email: lead.email || 'N/A',
			phone: lead.phone || 'N/A',
			convertedAt: format(new Date(lead.updatedAt), 'HH:mm:ss'),
		}));

		// Calculate conversion rate
		const conversionRate = newLeads.length > 0 ? (convertedLeads.length / newLeads.length) * 100 : 0;

		return {
			newLeadsCount: newLeads.length,
			convertedCount: convertedLeads.length,
			conversionRate: Math.round(conversionRate * 10) / 10,
			newLeads: newLeadsList,
			convertedLeads: convertedLeadsList,
		};
	}

	private async collectJournalData(userId: number, startDate: Date, endDate: Date) {
		// Journal entries for today
		const entries = await this.journalRepository.find({
			where: {
				owner: { uid: userId },
				createdAt: Between(startDate, endDate),
			},
			order: { createdAt: 'DESC' },
		});

		// Format entries for report
		const journalList = entries.map((entry) => ({
			id: entry.uid,
			title: entry.clientRef || 'Untitled Entry', // Using clientRef instead of name
			content: this.truncateText(entry.comments || '', 150), // Using comments instead of description
			createdAt: format(new Date(entry.createdAt), 'HH:mm:ss'),
			hasAttachments: !!entry.fileURL,
			fileURL: entry.fileURL,
		}));

		return {
			count: entries.length,
			entries: journalList,
			hasEntries: entries.length > 0,
		};
	}

	private async collectClientData(userId: number, startDate: Date, endDate: Date) {
		// New clients added today - filter by owner if client has owner field
		// Note: This might need adjustment based on your Client entity structure
		const newClients = await this.clientRepository.find({
			where: {
				createdAt: Between(startDate, endDate),
				// Add owner filter if Client entity has owner relation
				// owner: { uid: userId },
			},
		});

		// Client check-ins today - FIX: Filter check-ins by the specific user
		const clientCheckIns = await this.checkInRepository.find({
			where: {
				owner: { uid: userId }, // FIX: Filter by userId to only get this user's check-ins
				checkInTime: Between(startDate, endDate),
			},
			relations: ['client', 'owner'],
		});

		// Group check-ins by client
		const clientInteractionMap = new Map();
		clientCheckIns.forEach((checkIn) => {
			if (checkIn.client) {
				const clientId = checkIn.client.uid;
				if (!clientInteractionMap.has(clientId)) {
					clientInteractionMap.set(clientId, {
						client: checkIn.client,
						interactions: [],
					});
				}
				clientInteractionMap.get(clientId).interactions.push({
					id: checkIn.uid,
					type: 'check-in',
					timestamp: format(new Date(checkIn.checkInTime), 'HH:mm:ss'),
					location: `${checkIn?.checkInLocation}` || 'Unknown location',
				});
			}
		});

		// Format client data
		const clientInteractions = Array.from(clientInteractionMap.values()).map((item) => ({
			clientId: item.client.uid,
			clientName: item.client.name,
			interactionCount: item.interactions.length,
			interactions: item.interactions,
		}));

		return {
			newClients: newClients.length,
			totalInteractions: clientCheckIns.length,
			clientsInteractedWith: clientInteractionMap.size,
			clientInteractions: clientInteractions,
		};
	}

	private async collectClaimData(userId: number, startDate: Date, endDate: Date) {
		try {
			const claims = await this.claimRepository.find({
				where: {
					// Assuming 'owner' or 'createdBy' relates to the user
					// and 'createdAt' or a specific 'claimDate' field exists
					owner: { uid: userId }, // Adjust field name as per your Claim entity
					createdAt: Between(startDate, endDate), // Or relevant date field for the claim
				},
				order: { createdAt: 'DESC' }, // Or relevant date field
			});

			const claimsList = claims.map((claim) => ({
				id: claim.uid,
				title: claim.uid || 'Untitled Claim', // Temporary: using uid as title placeholder
				description: this.truncateText('', 100), // Temporary: empty description placeholder
				status: claim.status,
				createdAt: format(new Date(claim.createdAt), 'HH:mm:ss'),
				// Add other relevant claim fields
			}));

			return {
				count: claims.length,
				claims: claimsList,
				hasClaims: claims.length > 0,
			};
		} catch (error) {
			this.logger.error(`Error collecting claim data for user ${userId}: ${error.message}`, error.stack);
			return {
				count: 0,
				claims: [],
				hasClaims: false,
			};
		}
	}

	private async collectLocationData(userId: number, startDate: Date, endDate: Date) {
		try {
			// Use enhanced TrackingService to get comprehensive tracking data
			const trackingResult = await this.trackingService.getDailyTracking(userId, startDate);

			if (!trackingResult || !trackingResult.data) {
				return this.defaultLocationData();
			}

		const { 
			trackingPoints, 
			totalDistance, 
			locationAnalysis, 
			tripSummary, 
			stops, 
			geocodingStatus,
			movementEfficiency,
			locationProductivity,
			travelInsights 
		} = trackingResult.data;

		if (!trackingPoints || !trackingPoints.length) {
			this.logger.warn(`No tracking points found for user ${userId} on ${format(startDate, 'yyyy-MM-dd')}`);
			return this.defaultLocationData('0');
		}

			// Log geocoding status for monitoring
			if (geocodingStatus && geocodingStatus.usedFallback) {
				this.logger.warn(`Geocoding failed for user ${userId} on ${format(startDate, 'yyyy-MM-dd')}. Using fallback location data. Successful: ${geocodingStatus.successful}, Failed: ${geocodingStatus.failed}`);
			}

		// Extract distance value from formatted string or use tripSummary
		let totalDistanceKm = 0;
		if (tripSummary && tripSummary.totalDistanceKm) {
			totalDistanceKm = tripSummary.totalDistanceKm;
		} else if (typeof totalDistance === 'string') {
			// Parse from formatted string like "5.2 km" or "500 meters"
			const distanceMatch = totalDistance.match(/([0-9.]+)\s*(km|meters)/);
			if (distanceMatch) {
				const value = parseFloat(distanceMatch[1]);
				totalDistanceKm = distanceMatch[2] === 'km' ? value : value / 1000;
			}
		} else {
			totalDistanceKm = parseFloat(totalDistance) || 0;
		}

		// Generate distance insights based on total distance
		const generateDistanceInsights = (distanceKm: number) => {
			if (distanceKm < 0.5) { // Less than 500m
				return {
					category: 'minimal',
					message: '🚶‍♂️ Minimal movement detected - likely just walking around the workplace or getting some steps in at work',
					recommendation: 'Great job staying active even with minimal travel! Every step counts towards your daily activity.',
					icon: '🚶‍♂️',
					color: '#22c55e' // Green for positive/good
				};
			} else if (distanceKm < 2) { // 500m - 2km
				return {
					category: 'local',
					message: '🚗 Local movement - short trips within the work area or nearby locations',
					recommendation: 'Good local mobility! Consider if some short trips could be combined for efficiency.',
					icon: '🚗',
					color: '#3b82f6' // Blue for moderate
				};
			} else if (distanceKm < 10) { // 2km - 10km
				return {
					category: 'moderate',
					message: '🛣️ Moderate travel distance - covering good ground for work activities',
					recommendation: 'Solid travel efficiency! You\'re covering good distance for productive work.',
					icon: '🛣️',
					color: '#8b5cf6' // Purple for good
				};
			} else {
				return {
					category: 'extensive',
					message: '🗺️ Extensive travel - significant movement across multiple locations',
					recommendation: 'High mobility day! Consider route optimization for even better efficiency.',
					icon: '🗺️',
					color: '#f59e0b' // Amber for attention
				};
			}
		};

		const distanceInsights = generateDistanceInsights(totalDistanceKm);

		// Extract GPS accuracy filtering information
		let gpsAccuracyInfo = null;
		if (tripSummary && tripSummary.accuracyInfo) {
			const { accuracyInfo } = tripSummary;
			const filteredCount = accuracyInfo.inaccurateCount || 0;
			const originalCount = accuracyInfo.originalCount || trackingPoints.length;
			const filteredPercentage = originalCount > 0 ? Math.round((filteredCount / originalCount) * 100) : 0;

			gpsAccuracyInfo = {
				originalPointsCount: originalCount,
				filteredPointsCount: filteredCount,
				usedPointsCount: originalCount - filteredCount,
				filteredPercentage,
				needsAttention: filteredPercentage > 30, // Flag if >30% of points were filtered
				message: filteredCount > 0 
					? `${filteredCount} GPS points were filtered out due to poor accuracy (>${accuracyInfo.accuracyThreshold || 20}m)`
					: 'All GPS points had acceptable accuracy',
				recommendation: filteredCount > 0 
					? 'For more accurate location tracking, ensure "Precise Location" is enabled in your device settings for the Loro app'
					: 'Great! Your device is providing accurate location data',
				severityLevel: filteredPercentage > 50 ? 'high' : filteredPercentage > 30 ? 'medium' : 'low'
			};
		} else if (trackingPoints && trackingPoints.length > 0) {
			// Fallback when accuracy info is not available in tripSummary
			gpsAccuracyInfo = {
				originalPointsCount: trackingPoints.length,
				filteredPointsCount: 0,
				usedPointsCount: trackingPoints.length,
				filteredPercentage: 0,
				needsAttention: false,
				message: 'GPS accuracy filtering information not available',
				recommendation: 'Ensure "Precise Location" is enabled in your device settings for optimal tracking',
				severityLevel: 'low'
			};
		}

			// Format tracking points for detailed view
			const formattedTrackingPoints = trackingPoints.map((point) => ({
				type: 'tracking-point',
				timestamp: point.timestamp
					? format(new Date(point.timestamp), 'HH:mm:ss')
					: format(new Date(point.createdAt), 'HH:mm:ss'),
				latitude: point.latitude,
				longitude: point.longitude,
				address: point.address || `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`,
				accuracy: point.accuracy,
				speed: point.speed,
				// Add flag to indicate if this is fallback data
				isFallbackAddress: !point.address || point.address.includes(',') && point.addressDecodingError,
			}));

			// Format stops for email summary
			const formattedStops = stops ? stops.map((stop) => ({
				address: stop.address,
				latitude: stop.latitude,
				longitude: stop.longitude,
				duration: stop.durationFormatted,
				durationMinutes: stop.durationMinutes,
				startTime: format(new Date(stop.startTime), 'HH:mm'),
				endTime: format(new Date(stop.endTime), 'HH:mm'),
				pointsCount: stop.pointsCount,
				// Add flag to indicate if this is fallback data
				isFallbackAddress: stop.address && stop.address.includes(',') && stop.address.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/),
			})) : [];

		// Prepare email tracking data with comprehensive enhanced metrics
		// STANDARDIZE ALL DISTANCE REFERENCES TO USE ENHANCED CALCULATION
		const formattedDistance = `${totalDistanceKm.toFixed(1)} km`;
		const trackingDataForEmail = {
			// Primary enhanced distance field
			totalDistance: formattedDistance,
			totalDistanceKm: totalDistanceKm,
			// Legacy field mappings for backward compatibility
			totalDistanceFormatted: formattedDistance,
			distanceTraveled: formattedDistance,
			distanceKm: totalDistanceKm,
			locations: locationAnalysis?.locationsVisited || [],
			averageTimePerLocation: locationAnalysis?.averageTimePerLocationFormatted || '~',
			// Distance insights for contextual understanding
			distanceInsights: distanceInsights,
			// GPS accuracy filtering information
			gpsAccuracy: gpsAccuracyInfo,
			tripSummary: tripSummary ? {
				totalDistanceKm: totalDistanceKm,
				totalTimeFormatted: this.formatDuration(tripSummary.totalTimeMinutes),
				movingTimeFormatted: this.formatDuration(tripSummary.movingTimeMinutes),
				stoppedTimeFormatted: this.formatDuration(tripSummary.stoppedTimeMinutes),
				averageSpeedKmh: Math.round(tripSummary.averageSpeedKmh * 10) / 10,
				averageSpeed: `${Math.round(tripSummary.averageSpeedKmh * 10) / 10} km/h`,
				maxSpeedKmh: Math.round(tripSummary.maxSpeedKmh * 10) / 10,
				maxSpeed: `${Math.round(tripSummary.maxSpeedKmh * 10) / 10} km/h`,
				numberOfStops: tripSummary.numberOfStops,
				movingTimeMinutes: tripSummary.movingTimeMinutes,
				stoppedTimeMinutes: tripSummary.stoppedTimeMinutes,
			} : null,
			stops: formattedStops.slice(0, 10), // Limit to top 10 stops for email
			// Enhanced movement efficiency metrics
			movementEfficiency: movementEfficiency ? {
				efficiencyRating: movementEfficiency.efficiencyRating,
				productivityScore: movementEfficiency.productivityScore,
				travelOptimization: {
					score: movementEfficiency.travelOptimization?.optimizationScore || 'Medium',
					totalTravelDistance: movementEfficiency.travelOptimization?.totalTravelDistance || 0,
					suggestions: movementEfficiency.travelOptimization?.suggestions || [],
				},
			} : null,
			// Location productivity insights
			locationProductivity: locationProductivity ? {
				totalLocations: locationProductivity.totalLocations,
				averageTimePerStop: Math.round(locationProductivity.averageTimePerStop || 0),
				averageTimePerStopFormatted: this.formatDuration(locationProductivity.averageTimePerStop || 0),
				productiveStops: locationProductivity.productiveStops,
				productivityRatio: locationProductivity.totalLocations > 0 ? 
					Math.round((locationProductivity.productiveStops / locationProductivity.totalLocations) * 100) : 0,
				keyLocations: locationProductivity.keyLocations?.slice(0, 5)?.map(location => ({
					address: location.address,
					duration: location.durationFormatted,
					productivity: location.productivity,
					startTime: format(new Date(location.startTime), 'HH:mm'),
					endTime: format(new Date(location.endTime), 'HH:mm'),
				})) || [],
			} : null,
			// Travel insights and patterns
			travelInsights: travelInsights ? {
				totalTravelDistance: Math.round(travelInsights.totalTravelDistance * 10) / 10,
				travelEfficiency: {
					score: travelInsights.travelEfficiency?.score || 'Medium',
					avgSpeed: Math.round(travelInsights.travelEfficiency?.metrics?.avgSpeed * 10) / 10 || 0,
					maxSpeed: Math.round(travelInsights.travelEfficiency?.metrics?.maxSpeed * 10) / 10 || 0,
					movingRatio: Math.round((travelInsights.travelEfficiency?.metrics?.movingRatio || 0) * 100),
				},
				routeOptimization: {
					canOptimize: travelInsights.routeOptimization?.canOptimize || false,
					currentRouteDistance: travelInsights.routeOptimization?.currentRouteDistance || 0,
					potentialSavings: travelInsights.routeOptimization?.potentialSavings || 0,
					recommendation: travelInsights.routeOptimization?.recommendation || 'Route appears optimized',
				},
				movementPatterns: {
					pattern: travelInsights.movementPatterns?.pattern || 'Insufficient data',
					peakMovementHour: travelInsights.movementPatterns?.peakMovementHour,
					peakMovementDistance: Math.round((travelInsights.movementPatterns?.peakMovementDistance || 0) * 10) / 10,
					analysis: travelInsights.movementPatterns?.analysis || 'No pattern analysis available',
				},
			} : null,
			// Add geocoding status for transparency
			geocodingStatus: geocodingStatus ? {
				successful: geocodingStatus.successful,
				failed: geocodingStatus.failed,
				usedFallback: geocodingStatus.usedFallback,
				note: geocodingStatus.usedFallback ? 'Some locations shown as coordinates due to geocoding service issues' : null,
			} : null,
		};

		// STANDARDIZE ALL DISTANCE FIELD MAPPINGS TO USE ENHANCED CALCULATION
		const standardizedLocationData = {
			locations: formattedTrackingPoints,
			// PRIMARY ENHANCED DISTANCE FIELDS
			totalDistance: formattedDistance,
			totalDistanceKm: totalDistanceKm,
			// LEGACY FIELD MAPPINGS FOR FRONTEND/EMAIL COMPATIBILITY
			totalDistanceFormatted: formattedDistance,
			distanceTraveled: formattedDistance,
			distanceKm: totalDistanceKm,
			totalLocations: formattedTrackingPoints.length,
			trackingData: {
				...trackingDataForEmail,
				// ENSURE VISITS FIELD HAS ENHANCED DISTANCE
				visits: {
					totalDistance: formattedDistance,
					totalDistanceKm: totalDistanceKm,
					completedVisits: locationAnalysis?.locationsVisited?.length || 0,
					totalVisits: locationAnalysis?.locationsVisited?.length || 0,
					avgDuration: locationAnalysis?.averageTimePerLocationFormatted || '~',
					topLocations: formattedStops.slice(0, 3).map(stop => stop.address),
				},
				// ENSURE LOCATION FIELD HAS ENHANCED DISTANCE
				location: {
					totalDistance: formattedDistance,
					totalDistanceKm: totalDistanceKm,
					totalLocations: locationAnalysis?.locationsVisited?.length || 0,
					trackingData: {
						averageTimePerLocation: locationAnalysis?.averageTimePerLocationFormatted || '~',
						distanceTraveled: formattedDistance,
						totalDistanceKm: totalDistanceKm,
					},
				},
			},
			// Enhanced trip metrics with standardized distance
			tripMetrics: tripSummary ? {
				...tripSummary,
				totalDistanceKm: totalDistanceKm,
				totalDistance: formattedDistance,
			} : {
				totalDistanceKm: totalDistanceKm,
				totalDistance: formattedDistance,
			},
			stops: formattedStops,
			locationAnalysis: {
				...(locationAnalysis || {}),
				// Ensure location analysis has enhanced distance
				totalDistanceKm: totalDistanceKm,
				totalDistance: formattedDistance,
			},
			// Add comprehensive enhanced metrics
			movementEfficiency: movementEfficiency || null,
			locationProductivity: locationProductivity || null, 
			travelInsights: travelInsights || null,
			// Add geocoding status for monitoring
			geocodingStatus: geocodingStatus || null,
		};

		return standardizedLocationData;
		} catch (error) {
			this.logger.error(`Error collecting location data for user ${userId}: ${error.message}`, error.stack);
			return this.defaultLocationData();
		}
	}

	private defaultLocationData(totalDistanceStr?: string) {
		const totalDistanceKm = parseFloat(totalDistanceStr || '0') || 0;
		const formattedDistance = `${totalDistanceKm.toFixed(1)} km`;
		
		// STANDARDIZED DEFAULT DATA WITH ALL DISTANCE FIELD MAPPINGS
		return {
			locations: [],
			// PRIMARY ENHANCED DISTANCE FIELDS
			totalDistance: formattedDistance,
			totalDistanceKm: totalDistanceKm,
			// LEGACY FIELD MAPPINGS
			totalDistanceFormatted: formattedDistance,
			distanceTraveled: formattedDistance,
			distanceKm: totalDistanceKm,
			totalLocations: 0,
			trackingData: {
				totalDistance: formattedDistance,
				totalDistanceKm: totalDistanceKm,
				locations: [],
				averageTimePerLocation: '~',
				// ENSURE VISITS FIELD EXISTS
				visits: {
					totalDistance: formattedDistance,
					totalDistanceKm: totalDistanceKm,
					completedVisits: 0,
					totalVisits: 0,
					avgDuration: '~',
					topLocations: [],
				},
				// ENSURE LOCATION FIELD EXISTS
				location: {
					totalDistance: formattedDistance,
					totalDistanceKm: totalDistanceKm,
					totalLocations: 0,
					trackingData: {
						averageTimePerLocation: '~',
						distanceTraveled: formattedDistance,
						totalDistanceKm: totalDistanceKm,
					},
				},
			},
			tripMetrics: {
				totalDistanceKm: totalDistanceKm,
				totalDistance: formattedDistance,
			},
			locationAnalysis: {
				totalDistanceKm: totalDistanceKm,
				totalDistance: formattedDistance,
			},
		};
	}

	private formatDuration(minutes: number): string {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}h ${mins}m`;
	}

	private truncateText(text: string, maxLength: number): string {
		if (!text) return '';
		return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
	}

	private async collectQuotationData(userId: number, startDate: Date, endDate: Date) {
		try {
			// Get quotations created by the user in the specified date range
			const quotations = await this.quotationRepository.find({
				where: {
					placedBy: { uid: userId },
					createdAt: Between(startDate, endDate),
				},
				relations: ['quotationItems', 'client'],
			});

			// Calculate total revenue
			let totalRevenue = 0;
			const quotationDetails = quotations.map((quotation) => {
				const amount =
					typeof quotation.totalAmount === 'string'
						? parseFloat(quotation.totalAmount)
						: quotation.totalAmount;

				totalRevenue += Number.isNaN(amount) ? 0 : amount;

				return {
					id: quotation.uid,
					quotationNumber: quotation.quotationNumber,
					clientName: quotation.client ? quotation.client.name : 'Unknown',
					totalAmount: amount,
					totalItems: quotation.totalItems,
					status: quotation.status,
					createdAt: format(new Date(quotation.createdAt), 'HH:mm:ss'),
				};
			});

			// Format the total revenue with currency symbol
			const totalRevenueFormatted = new Intl.NumberFormat('en-ZA', {
				style: 'currency',
				currency: 'ZAR',
			}).format(totalRevenue);

			return {
				totalQuotations: quotations.length,
				totalRevenue,
				totalRevenueFormatted,
				quotationDetails,
			};
		} catch (error) {
			this.logger.error(`Error collecting quotation data: ${error.message}`, error.stack);
			return {
				totalQuotations: 0,
				totalRevenue: 0,
				totalRevenueFormatted: 'R0.00',
				quotationDetails: [],
			};
		}
	}

	private async collectRewardsData(userId: number, startDate: Date, endDate: Date) {
		try {
			// Get user rewards
			const userRewards = await this.userRewardsRepository.findOne({
				where: { owner: { uid: userId } },
				relations: ['owner'],
			});

			if (!userRewards) {
				return {
					dailyXPEarned: 0,
					currentLevel: 1,
					currentRank: 'ROOKIE',
					totalXP: 0,
					currentXP: 0,
					xpBreakdown: {
						tasks: 0,
						leads: 0,
						sales: 0,
						attendance: 0,
						collaboration: 0,
						other: 0,
					},
					dailyTransactions: [],
					leaderboardPosition: null,
				};
			}

			// Get XP transactions for today
			const dailyTransactions = await this.xpTransactionRepository.find({
				where: {
					userRewards: { uid: userRewards.uid },
					timestamp: Between(startDate, endDate),
				},
				order: { timestamp: 'DESC' },
			});

			// Calculate daily XP earned
			const dailyXPEarned = dailyTransactions.reduce((total, transaction) => {
				return total + transaction.xpAmount;
			}, 0);

			// Get leaderboard position
			const leaderboard = await this.userRewardsRepository.find({
				relations: ['owner'],
				order: { totalXP: 'DESC' },
				take: 100, // Get top 100 to find position
			});

			const leaderboardPosition = leaderboard.findIndex(entry => entry.uid === userRewards.uid) + 1;

			// Format daily transactions
			const formattedTransactions = dailyTransactions.map(transaction => ({
				action: transaction.action,
				xpAmount: transaction.xpAmount,
				timestamp: format(new Date(transaction.timestamp), 'HH:mm:ss'),
				sourceType: transaction.metadata?.sourceType || 'unknown',
				sourceId: transaction.metadata?.sourceId || null,
			}));

			return {
				dailyXPEarned,
				currentLevel: userRewards.level,
				currentRank: userRewards.rank,
				totalXP: userRewards.totalXP,
				currentXP: userRewards.currentXP,
				xpBreakdown: userRewards.xpBreakdown || {
					tasks: 0,
					leads: 0,
					sales: 0,
					attendance: 0,
					collaboration: 0,
					other: 0,
				},
				dailyTransactions: formattedTransactions,
				leaderboardPosition: leaderboardPosition > 0 ? leaderboardPosition : null,
			};
		} catch (error) {
			this.logger.error(`Error collecting rewards data for user ${userId}: ${error.message}`, error.stack);
			return {
				dailyXPEarned: 0,
				currentLevel: 1,
				currentRank: 'ROOKIE',
				totalXP: 0,
				currentXP: 0,
				xpBreakdown: {
					tasks: 0,
					leads: 0,
					sales: 0,
					attendance: 0,
					collaboration: 0,
					other: 0,
				},
				dailyTransactions: [],
				leaderboardPosition: null,
			};
		}
	}

	private async collectTargetsData(userId: number) {
		try {
			// Get user targets
			const userTarget = await this.userTargetRepository.findOne({
				where: { user: { uid: userId } },
				relations: ['user'],
			});

			if (!userTarget) {
				return {
					hasTargets: false,
					targetPeriod: null,
					periodStartDate: null,
					periodEndDate: null,
					salesTarget: null,
					hoursTarget: null,
					leadsTarget: null,
					clientsTarget: null,
					checkInsTarget: null,
					callsTarget: null,
					targetProgress: {},
				};
			}

			// Calculate progress percentages
			const calculateProgress = (current: number, target: number) => {
				if (!target || target <= 0) return 0;
				return Math.min(Math.round((current / target) * 100), 100);
			};

			const targetProgress = {
				sales: {
					current: userTarget.currentSalesAmount || 0,
					target: userTarget.targetSalesAmount || 0,
					progress: calculateProgress(userTarget.currentSalesAmount || 0, userTarget.targetSalesAmount || 0),
					currency: userTarget.targetCurrency || 'ZAR',
				},
				hours: {
					current: userTarget.currentHoursWorked || 0,
					target: userTarget.targetHoursWorked || 0,
					progress: calculateProgress(userTarget.currentHoursWorked || 0, userTarget.targetHoursWorked || 0),
				},
				leads: {
					current: userTarget.currentNewLeads || 0,
					target: userTarget.targetNewLeads || 0,
					progress: calculateProgress(userTarget.currentNewLeads || 0, userTarget.targetNewLeads || 0),
				},
				clients: {
					current: userTarget.currentNewClients || 0,
					target: userTarget.targetNewClients || 0,
					progress: calculateProgress(userTarget.currentNewClients || 0, userTarget.targetNewClients || 0),
				},
				checkIns: {
					current: userTarget.currentCheckIns || 0,
					target: userTarget.targetCheckIns || 0,
					progress: calculateProgress(userTarget.currentCheckIns || 0, userTarget.targetCheckIns || 0),
				},
				calls: {
					current: userTarget.currentCalls || 0,
					target: userTarget.targetCalls || 0,
					progress: calculateProgress(userTarget.currentCalls || 0, userTarget.targetCalls || 0),
				},
			};

			return {
				hasTargets: true,
				targetPeriod: userTarget.targetPeriod || 'Monthly',
				periodStartDate: userTarget.periodStartDate ? format(new Date(userTarget.periodStartDate), 'yyyy-MM-dd') : null,
				periodEndDate: userTarget.periodEndDate ? format(new Date(userTarget.periodEndDate), 'yyyy-MM-dd') : null,
				salesTarget: {
					current: userTarget.currentSalesAmount || 0,
					target: userTarget.targetSalesAmount || 0,
					currency: userTarget.targetCurrency || 'ZAR',
					formatted: new Intl.NumberFormat('en-ZA', {
						style: 'currency',
						currency: userTarget.targetCurrency || 'ZAR',
					}).format(userTarget.currentSalesAmount || 0),
					targetFormatted: new Intl.NumberFormat('en-ZA', {
						style: 'currency',
						currency: userTarget.targetCurrency || 'ZAR',
					}).format(userTarget.targetSalesAmount || 0),
				},
				hoursTarget: {
					current: userTarget.currentHoursWorked || 0,
					target: userTarget.targetHoursWorked || 0,
				},
				leadsTarget: {
					current: userTarget.currentNewLeads || 0,
					target: userTarget.targetNewLeads || 0,
				},
				clientsTarget: {
					current: userTarget.currentNewClients || 0,
					target: userTarget.targetNewClients || 0,
				},
				checkInsTarget: {
					current: userTarget.currentCheckIns || 0,
					target: userTarget.targetCheckIns || 0,
				},
				callsTarget: {
					current: userTarget.currentCalls || 0,
					target: userTarget.targetCalls || 0,
				},
				targetProgress,
			};
		} catch (error) {
			this.logger.error(`Error collecting targets data for user ${userId}: ${error.message}`, error.stack);
			return {
				hasTargets: false,
				targetPeriod: null,
				periodStartDate: null,
				periodEndDate: null,
				salesTarget: null,
				hoursTarget: null,
				leadsTarget: null,
				clientsTarget: null,
				checkInsTarget: null,
				callsTarget: null,
				targetProgress: {},
			};
		}
	}

	/**
	 * Collect comprehensive performance analytics
	 */
	private async collectPerformanceAnalytics(userId: number, startDate: Date, endDate: Date) {
		try {
			// Get historical data for trend analysis (last 7 days)
			const weekStart = subDays(startDate, 7);
			
			// Collect performance data over the week
			const weeklyData = await Promise.all([
				this.collectQuotationData(userId, weekStart, startDate),
				this.collectTaskMetrics(userId, weekStart, startDate),
				this.collectLeadMetrics(userId, weekStart, startDate),
				this.collectAttendanceData(userId, weekStart, startDate),
			]);

			const [weeklyQuotations, weeklyTasks, weeklyLeads, weeklyAttendance] = weeklyData;

			// Calculate efficiency scores
			const taskEfficiency = weeklyTasks.completedCount / Math.max(weeklyTasks.createdCount, 1) * 100;
			const leadConversionEfficiency = weeklyLeads.convertedCount / Math.max(weeklyLeads.newLeadsCount, 1) * 100;
			const revenuePerHour = weeklyQuotations.totalRevenue / Math.max(weeklyAttendance.totalWorkMinutes / 60, 1);

			// Calculate performance scores
			const performanceScore = this.calculateOverallPerformanceScore({
				taskEfficiency,
				leadConversionEfficiency,
				revenuePerHour,
				punctuality: weeklyAttendance.totalShifts > 0 ? 100 : 0, // Simplified for now
			});

			return {
				overallScore: Math.round(performanceScore * 10) / 10,
				taskEfficiency: Math.round(taskEfficiency * 10) / 10,
				leadConversionRate: Math.round(leadConversionEfficiency * 10) / 10,
				revenuePerHour: Math.round(revenuePerHour * 100) / 100,
				weeklyTrends: {
					quotations: weeklyQuotations.totalQuotations,
					revenue: weeklyQuotations.totalRevenueFormatted,
					tasksCompleted: weeklyTasks.completedCount,
					leadsGenerated: weeklyLeads.newLeadsCount,
					hoursWorked: Math.round((weeklyAttendance.totalWorkMinutes / 60) * 10) / 10,
				},
				strengths: this.identifyStrengths({ taskEfficiency, leadConversionEfficiency, revenuePerHour }),
				improvementAreas: this.identifyImprovementAreas({ taskEfficiency, leadConversionEfficiency, revenuePerHour }),
			};
		} catch (error) {
			this.logger.error(`Error collecting performance analytics: ${error.message}`, error.stack);
			return {
				overallScore: 0,
				taskEfficiency: 0,
				leadConversionRate: 0,
				revenuePerHour: 0,
				weeklyTrends: {},
				strengths: [],
				improvementAreas: [],
			};
		}
	}

	/**
	 * Collect productivity insights and patterns
	 */
	private async collectProductivityInsights(userId: number, startDate: Date, endDate: Date) {
		try {
			// Calculate peak productivity hours based on task completion times
			const completedTasksQuery = this.taskRepository
				.createQueryBuilder('task')
				.where('task.status = :status', { status: TaskStatus.COMPLETED })
				.andWhere('task.completionDate BETWEEN :startDate AND :endDate', { 
					startDate: subDays(startDate, 30), 
					endDate 
				})
				.andWhere('task.assignees @> CAST(:userIdJson AS jsonb)', { 
					userIdJson: JSON.stringify([{ uid: userId }])
				});
			const completedTasks = await completedTasksQuery.getMany();

			const hourlyProductivity = new Array(24).fill(0);
			completedTasks.forEach(task => {
				if (task.completionDate) {
					const hour = new Date(task.completionDate).getHours();
					hourlyProductivity[hour]++;
				}
			});

			const peakHour = hourlyProductivity.indexOf(Math.max(...hourlyProductivity));
			
			// Calculate focus time (continuous work periods)
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					owner: { uid: userId },
					checkIn: Between(subDays(startDate, 7), endDate),
				},
				order: { checkIn: 'DESC' },
			});

			const avgFocusTime = this.calculateAverageFocusTime(attendanceRecords);
			const workPatterns = this.analyzeWorkPatterns(attendanceRecords);

			return {
				peakProductivityHour: peakHour,
				averageFocusTime: this.formatDuration(avgFocusTime),
				productivityScore: this.calculateProductivityScore(hourlyProductivity, avgFocusTime),
				workPatterns: {
					preferredStartTime: workPatterns.avgStartTime,
					preferredEndTime: workPatterns.avgEndTime,
					consistencyScore: workPatterns.consistencyScore,
				},
				recommendations: this.generateProductivityRecommendations({
					peakHour,
					avgFocusTime,
					consistency: workPatterns.consistencyScore,
				}),
			};
		} catch (error) {
			this.logger.error(`Error collecting productivity insights: ${error.message}`, error.stack);
			return {
				peakProductivityHour: 9,
				averageFocusTime: '0h 0m',
				productivityScore: 0,
				workPatterns: {},
				recommendations: [],
			};
		}
	}

	/**
	 * Collect weekly comparison data
	 */
	private async collectWeeklyComparison(userId: number, currentDate: Date) {
		try {
			const currentWeekStart = startOfDay(subDays(currentDate, 6));
			const previousWeekStart = startOfDay(subDays(currentWeekStart, 7));
			const previousWeekEnd = endOfDay(subDays(currentWeekStart, 1));

			const [currentWeekData, previousWeekData] = await Promise.all([
				this.getWeeklyMetrics(userId, currentWeekStart, currentDate),
				this.getWeeklyMetrics(userId, previousWeekStart, previousWeekEnd),
			]);

			return {
				current: currentWeekData,
				previous: previousWeekData,
				changes: {
					hoursWorked: ReportUtils.calculateGrowth(currentWeekData.hoursWorked, previousWeekData.hoursWorked),
					tasksCompleted: ReportUtils.calculateGrowth(currentWeekData.tasksCompleted, previousWeekData.tasksCompleted),
					revenue: ReportUtils.calculateGrowth(currentWeekData.revenue, previousWeekData.revenue),
					leads: ReportUtils.calculateGrowth(currentWeekData.leads, previousWeekData.leads),
				},
				trend: this.determineTrend(currentWeekData, previousWeekData),
			};
		} catch (error) {
			this.logger.error(`Error collecting weekly comparison: ${error.message}`, error.stack);
			return {
				current: {},
				previous: {},
				changes: {},
				trend: 'stable',
			};
		}
	}

	/**
	 * Generate predictive analytics for target achievement
	 */
	private async generatePredictiveAnalytics(userId: number, startDate: Date, endDate: Date) {
		try {
			const targets = await this.collectTargetsData(userId);
			
			if (!targets.hasTargets) {
				return {
					targetAchievementProbability: 0,
					projectedCompletion: {},
					recommendations: [],
					riskFactors: [],
				};
			}

			// Get historical performance data for the current period
			const periodStart = targets.periodStartDate ? new Date(targets.periodStartDate) : subDays(startDate, 30);
			const daysSinceStart = Math.max(1, Math.floor((startDate.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));
			const totalPeriodDays = targets.periodEndDate ? 
				Math.floor((new Date(targets.periodEndDate).getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) : 30;

			// Calculate velocity for each target category
			const salesVelocity = targets.salesTarget ? targets.salesTarget.current / daysSinceStart : 0;
			const hoursVelocity = targets.hoursTarget ? targets.hoursTarget.current / daysSinceStart : 0;
			const leadsVelocity = targets.leadsTarget ? targets.leadsTarget.current / daysSinceStart : 0;

			// Project end-of-period values
			const projectedSales = salesVelocity * totalPeriodDays;
			const projectedHours = hoursVelocity * totalPeriodDays;
			const projectedLeads = leadsVelocity * totalPeriodDays;

			// Calculate achievement probabilities
			const salesProbability = targets.salesTarget ? Math.min(100, (projectedSales / targets.salesTarget.target) * 100) : 0;
			const hoursProbability = targets.hoursTarget ? Math.min(100, (projectedHours / targets.hoursTarget.target) * 100) : 0;
			const leadsProbability = targets.leadsTarget ? Math.min(100, (projectedLeads / targets.leadsTarget.target) * 100) : 0;

			const overallProbability = (salesProbability + hoursProbability + leadsProbability) / 3;

			return {
				targetAchievementProbability: Math.round(overallProbability),
				projectedCompletion: {
					sales: targets.salesTarget ? {
						projected: projectedSales,
						target: targets.salesTarget.target,
						probability: Math.round(salesProbability),
					} : null,
					hours: targets.hoursTarget ? {
						projected: projectedHours,
						target: targets.hoursTarget.target,
						probability: Math.round(hoursProbability),
					} : null,
					leads: targets.leadsTarget ? {
						projected: projectedLeads,
						target: targets.leadsTarget.target,
						probability: Math.round(leadsProbability),
					} : null,
				},
				recommendations: this.generateTargetRecommendations({
					salesProbability,
					hoursProbability,
					leadsProbability,
					daysRemaining: totalPeriodDays - daysSinceStart,
				}),
				riskFactors: this.identifyRiskFactors({
					salesProbability,
					hoursProbability,
					leadsProbability,
				}),
			};
		} catch (error) {
			this.logger.error(`Error generating predictive analytics: ${error.message}`, error.stack);
			return {
				targetAchievementProbability: 0,
				projectedCompletion: {},
				recommendations: [],
				riskFactors: [],
			};
		}
	}

	/**
	 * Collect wellness and work-life balance metrics
	 */
	private async collectWellnessMetrics(userId: number, startDate: Date, endDate: Date) {
		try {
			// Get attendance data for wellness analysis
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					owner: { uid: userId },
					checkIn: Between(subDays(startDate, 7), endDate),
				},
				order: { checkIn: 'DESC' },
			});

			const workLifeBalance = this.calculateWorkLifeBalance(attendanceRecords);
			const stressIndicators = this.calculateStressIndicators(attendanceRecords);
			const wellnessScore = this.calculateWellnessScore(workLifeBalance, stressIndicators);

			return {
				wellnessScore: Math.round(wellnessScore),
				workLifeBalance: {
					score: Math.round(workLifeBalance.score),
					averageHoursPerDay: workLifeBalance.avgHoursPerDay,
					overtimeDays: workLifeBalance.overtimeDays,
					recommendedBreaks: workLifeBalance.recommendedBreaks,
				},
				stressLevel: stressIndicators.level,
				recommendations: this.generateWellnessRecommendations(wellnessScore, workLifeBalance, stressIndicators),
			};
		} catch (error) {
			this.logger.error(`Error collecting wellness metrics: ${error.message}`, error.stack);
			return {
				wellnessScore: 75,
				workLifeBalance: { score: 75 },
				stressLevel: 'moderate',
				recommendations: [],
			};
		}
	}

	// Helper methods for analytics

	private calculateOverallPerformanceScore(metrics: any): number {
		const weights = { taskEfficiency: 0.3, leadConversionEfficiency: 0.3, revenuePerHour: 0.3, punctuality: 0.1 };
		return Object.entries(weights).reduce((score, [key, weight]) => score + (metrics[key] || 0) * weight, 0) / 100;
	}

	private identifyStrengths(metrics: any): string[] {
		const strengths = [];
		if (metrics.taskEfficiency > 80) strengths.push('Excellent task completion rate');
		if (metrics.leadConversionEfficiency > 15) strengths.push('Strong lead conversion');
		if (metrics.revenuePerHour > 100) strengths.push('High revenue productivity');
		return strengths;
	}

	private identifyImprovementAreas(metrics: any): string[] {
		const areas = [];
		if (metrics.taskEfficiency < 60) areas.push('Task completion efficiency');
		if (metrics.leadConversionEfficiency < 10) areas.push('Lead conversion rate');
		if (metrics.revenuePerHour < 50) areas.push('Revenue per hour');
		return areas;
	}

	private calculateAverageFocusTime(records: Attendance[]): number {
		// Simplified calculation - average continuous work time
		if (records.length === 0) return 0;
		const totalMinutes = records.reduce((sum, record) => {
			if (record.checkIn && record.checkOut) {
				return sum + differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
			}
			return sum;
		}, 0);
		return totalMinutes / records.length;
	}

	private analyzeWorkPatterns(records: Attendance[]): any {
		// Simplified work pattern analysis
		const startTimes = records.filter(r => r.checkIn).map(r => new Date(r.checkIn).getHours());
		const endTimes = records.filter(r => r.checkOut).map(r => new Date(r.checkOut).getHours());
		
		return {
			avgStartTime: startTimes.length > 0 ? Math.round(startTimes.reduce((a, b) => a + b, 0) / startTimes.length) : 9,
			avgEndTime: endTimes.length > 0 ? Math.round(endTimes.reduce((a, b) => a + b, 0) / endTimes.length) : 17,
			consistencyScore: 85, // Simplified for now
		};
	}

	private calculateProductivityScore(hourlyData: number[], focusTime: number): number {
		const peakHours = Math.max(...hourlyData);
		const focusScore = Math.min(100, focusTime / 4); // 4 hours = 100%
		return Math.round((peakHours * 10 + focusScore) / 2);
	}

	private generateProductivityRecommendations(data: any): string[] {
		const recommendations = [];
		if (data.peakHour < 10) recommendations.push('Consider scheduling important tasks in the morning');
		if (data.avgFocusTime < 120) recommendations.push('Try to extend focus periods with time-blocking');
		if (data.consistency < 70) recommendations.push('Work on maintaining consistent work patterns');
		return recommendations;
	}

	private async getWeeklyMetrics(userId: number, startDate: Date, endDate: Date): Promise<any> {
		const [attendance, tasks, quotations, leads] = await Promise.all([
			this.collectAttendanceData(userId, startDate, endDate),
			this.collectTaskMetrics(userId, startDate, endDate),
			this.collectQuotationData(userId, startDate, endDate),
			this.collectLeadMetrics(userId, startDate, endDate),
		]);

		return {
			hoursWorked: Math.round((attendance.totalWorkMinutes / 60) * 10) / 10,
			tasksCompleted: tasks.completedCount,
			revenue: quotations.totalRevenue,
			leads: leads.newLeadsCount,
		};
	}

	private determineTrend(current: any, previous: any): string {
		const improvements = Object.keys(current).filter(key => (current[key] || 0) > (previous[key] || 0)).length;
		const declines = Object.keys(current).filter(key => (current[key] || 0) < (previous[key] || 0)).length;
		
		if (improvements > declines) return 'improving';
		if (declines > improvements) return 'declining';
		return 'stable';
	}

	private generateTargetRecommendations(probabilities: any): string[] {
		const recommendations = [];
		if (probabilities.salesProbability < 80) {
			recommendations.push('Focus on higher-value deals to improve sales target achievement');
		}
		if (probabilities.hoursProbability < 80) {
			recommendations.push('Consider optimizing work schedule to meet hours target');
		}
		if (probabilities.leadsProbability < 80) {
			recommendations.push('Increase lead generation activities and networking');
		}
		return recommendations;
	}

	private identifyRiskFactors(probabilities: any): string[] {
		const risks = [];
		if (probabilities.salesProbability < 60) risks.push('Sales target at risk');
		if (probabilities.hoursProbability < 60) risks.push('Hours target may not be met');
		if (probabilities.leadsProbability < 60) risks.push('Lead generation below expected pace');
		return risks;
	}

	private calculateWorkLifeBalance(records: Attendance[]): any {
		const totalHours = records.reduce((sum, record) => {
			if (record.checkIn && record.checkOut) {
				return sum + differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn)) / 60;
			}
			return sum;
		}, 0);

		const avgHoursPerDay = records.length > 0 ? totalHours / records.length : 0;
		const overtimeDays = records.filter(record => {
			if (record.checkIn && record.checkOut) {
				const hours = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn)) / 60;
				return hours > 8;
			}
			return false;
		}).length;

		const score = Math.max(0, 100 - (avgHoursPerDay - 8) * 10 - overtimeDays * 5);

		return {
			score,
			avgHoursPerDay: Math.round(avgHoursPerDay * 10) / 10,
			overtimeDays,
			recommendedBreaks: Math.max(0, Math.floor(avgHoursPerDay / 4)),
		};
	}

	private calculateStressIndicators(records: Attendance[]): any {
		const longDays = records.filter(record => {
			if (record.checkIn && record.checkOut) {
				const hours = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn)) / 60;
				return hours > 10;
			}
			return false;
		}).length;

		const level = longDays > 3 ? 'high' : longDays > 1 ? 'moderate' : 'low';
		return { level, longDays };
	}

	private calculateWellnessScore(workLifeBalance: any, stressIndicators: any): number {
		let score = workLifeBalance.score;
		if (stressIndicators.level === 'high') score -= 20;
		else if (stressIndicators.level === 'moderate') score -= 10;
		return Math.max(0, Math.min(100, score));
	}

	private generateWellnessRecommendations(score: number, workLife: any, stress: any): string[] {
		const recommendations = [];
		if (score < 60) recommendations.push('Consider implementing better work-life balance practices');
		if (workLife.overtimeDays > 2) recommendations.push('Try to reduce overtime frequency');
		if (stress.level === 'high') recommendations.push('Take regular breaks and consider stress management techniques');
		if (workLife.avgHoursPerDay > 9) recommendations.push('Aim for more reasonable daily working hours');
		return recommendations;
	}
}
