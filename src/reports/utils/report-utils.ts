import { Repository, Between, Not, In } from 'typeorm';
import { format } from 'date-fns';
import { LeadStatus } from '../../lib/enums/lead.enums';
import { TaskStatus, TaskPriority } from '../../lib/enums/task.enums';

export class ReportUtils {
	/**
	 * Calculate growth percentage between current and previous values
	 */
	static calculateGrowth(current: number, previous: number): string {
		if (previous === 0) {
			return current > 0 ? '+100%' : '0%';
		}
		if (current === 0 && previous === 0) {
			return '0%';
		}
		const growth = ((current - previous) / previous) * 100;
		const sign = growth >= 0 ? '+' : '';
		return `${sign}${Math.round(growth * 10) / 10}%`;
	}

	/**
	 * Collect attendance data for a user within a date range
	 */
	static async collectAttendanceData(
		attendanceRepository: Repository<any>,
		userId: number,
		startDate: Date,
		endDate: Date
	): Promise<{ totalWorkMinutes: number }> {
		const records = await attendanceRepository.find({
			where: { owner: { uid: userId }, checkIn: Between(startDate, endDate) },
			order: { checkIn: 'ASC' },
		});

		const totalWorkMinutes = records.reduce((sum, r) => {
			const start = r.checkIn ? new Date(r.checkIn).getTime() : 0;
			const end = r.checkOut ? new Date(r.checkOut).getTime() : start;
			const delta = Math.max(0, Math.floor((end - start) / (1000 * 60)));
			return sum + delta;
		}, 0);

		return { totalWorkMinutes };
	}

	/**
	 * Format report title based on granularity
	 */
	static formatReportTitle(granularity: string): string {
		switch (granularity) {
			case 'end-of-day':
				return 'Daily Activity Summary';
			case 'end-of-week':
				return 'Weekly Activity Summary';
			case 'weekly':
				return 'Weekly Organisation Report';
			case 'daily':
			default:
				return 'Daily Organisation Report';
		}
	}

	/**
	 * Get email period label based on granularity
	 */
	static getEmailPeriodLabel(granularity: string): string {
		switch (granularity) {
			case 'end-of-day':
				return 'Yesterday';
			case 'end-of-week':
				return 'Last Week';
			case 'weekly':
				return 'This Week';
			case 'daily':
			default:
				return 'Today';
		}
	}

	/**
	 * Format currency values
	 */
	static formatCurrency(amount: number, currency: string = 'ZAR'): string {
		return new Intl.NumberFormat('en-ZA', {
			style: 'currency',
			currency: currency,
		}).format(amount);
	}

	/**
	 * Calculate progress percentage
	 */
	static calculateProgress(current: number, target: number): number {
		if (target === 0) return 0;
		return Math.round((current / target) * 100);
	}

	/**
	 * Format date range for reports
	 */
	static formatDateRange(startDate: Date, endDate: Date, granularity: string): string {
		if (granularity === 'weekly' || granularity === 'end-of-week') {
			return `${format(startDate, 'yyyy-MM-dd')} - ${format(endDate, 'yyyy-MM-dd')}`;
		}
		return format(startDate, 'yyyy-MM-dd');
	}

	/**
	 * Calculate remaining amount to achieve target
	 */
	static calculateRemaining(current: number, target: number): number {
		return Math.max(0, target - current);
	}

	/**
	 * Generate performance insights based on metrics
	 */
	static generatePerformanceInsights(metrics: any): string[] {
		const insights: string[] = [];

		if (metrics.hoursWorked > 40) {
			insights.push('High work hours detected - consider work-life balance');
		}

		if (metrics.quotationsRevenue > metrics.targetSalesAmount * 1.2) {
			insights.push('Excellent sales performance - above target by 20%');
		}

		if (metrics.leadsConverted / metrics.leadsNew < 0.1) {
			insights.push('Lead conversion rate needs improvement');
		}

		return insights;
	}

	/**
	 * Collect lead data for a user within a date range
	 */
	static async collectLeadData(
		leadRepository: Repository<any>,
		userId: number,
		startDate: Date,
		endDate: Date
	): Promise<{
		newLeads: any[];
		convertedLeads: any[];
		newLeadsCount: number;
		convertedCount: number;
		conversionRate: number;
	}> {
		// New leads captured
		const newLeads = await leadRepository.find({
			where: {
				ownerUid: userId,
				createdAt: Between(startDate, endDate),
			},
		});

		// Leads converted
		const convertedLeads = await leadRepository.find({
			where: {
				ownerUid: userId,
				status: LeadStatus.CONVERTED,
				updatedAt: Between(startDate, endDate),
			},
		});

		// Calculate conversion rate
		const conversionRate = newLeads.length > 0 ? (convertedLeads.length / newLeads.length) * 100 : 0;

		return {
			newLeads,
			convertedLeads,
			newLeadsCount: newLeads.length,
			convertedCount: convertedLeads.length,
			conversionRate: Math.round(conversionRate * 10) / 10,
		};
	}

	/**
	 * Collect task data for a user within a date range
	 */
	static async collectTaskData(
		taskRepository: Repository<any>,
		userId: number,
		startDate: Date,
		endDate: Date
	): Promise<{
		completedTasks: any[];
		createdTasks: any[];
		completedCount: number;
		createdCount: number;
		completionRate: number;
	}> {
		// Tasks completed
		const completedTasks = await taskRepository.find({
			where: {
				status: TaskStatus.COMPLETED,
				completionDate: Between(startDate, endDate),
				assignees: { uid: userId },
			},
		});

		// Tasks created
		const createdTasks = await taskRepository.find({
			where: {
				creator: { uid: userId },
				createdAt: Between(startDate, endDate),
			},
		});

		// Calculate completion rate (this could be enhanced with more logic)
		const completionRate = completedTasks.length > 0 ? 100 : 0;

		return {
			completedTasks,
			createdTasks,
			completedCount: completedTasks.length,
			createdCount: createdTasks.length,
			completionRate,
		};
	}

	/**
	 * Collect quotation data for a user within a date range
	 */
	static async collectQuotationData(
		quotationRepository: Repository<any>,
		userId: number,
		startDate: Date,
		endDate: Date
	): Promise<{
		quotations: any[];
		count: number;
		totalRevenue: number;
	}> {
		const quotations = await quotationRepository.find({
			where: { placedBy: { uid: userId }, createdAt: Between(startDate, endDate) },
			relations: ['client'],
		});

		const totalRevenue = quotations.reduce((sum, q) => {
			const amount = typeof q.totalAmount === 'string' ? parseFloat(q.totalAmount) : q.totalAmount || 0;
			return sum + (Number.isNaN(amount) ? 0 : amount);
		}, 0);

		return {
			quotations,
			count: quotations.length,
			totalRevenue,
		};
	}

	/**
	 * Collect check-in data for a user within a date range
	 */
	static async collectCheckInData(
		checkInRepository: Repository<any>,
		userId: number,
		startDate: Date,
		endDate: Date
	): Promise<{
		checkIns: any[];
		count: number;
	}> {
		const checkIns = await checkInRepository.find({
			where: { owner: { uid: userId }, checkInTime: Between(startDate, endDate) },
			relations: ['client'],
		});

		return {
			checkIns,
			count: checkIns.length,
		};
	}

	/**
	 * Collect claim data for a user within a date range
	 */
	static async collectClaimData(
		claimRepository: Repository<any>,
		userId: number,
		startDate: Date,
		endDate: Date
	): Promise<{
		claims: any[];
		count: number;
	}> {
		const claims = await claimRepository.find({
			where: { owner: { uid: userId }, createdAt: Between(startDate, endDate) },
		});

		return {
			claims,
			count: claims.length,
		};
	}

	/**
	 * Generate email report data structure for templates
	 */
	static generateEmailReportData(
		reportType: string,
		granularity: string,
		startDate: Date,
		endDate: Date,
		metrics: any,
		insights: any[] = []
	): any {
		return {
			reportType,
			title: this.formatReportTitle(granularity),
			period: granularity,
			date: this.formatDateRange(startDate, endDate, granularity),
			summaryLabel: this.getEmailPeriodLabel(granularity),
			metrics,
			insights,
			dashboardUrl: process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN || 'https://loro.co.za',
			generatedAt: new Date(),
		};
	}

	/**
	 * Truncate text to specified length
	 */
	static truncateText(text: string, maxLength: number): string {
		if (!text) return '';
		return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
	}

	/**
	 * Calculate team performance metrics
	 */
	static calculateTeamMetrics(userDataArray: any[]): {
		totalUsers: number;
		activeUsers: number;
		topPerformers: any[];
		lowPerformers: any[];
		averageMetrics: any;
	} {
		const totalUsers = userDataArray.length;
		const activeUsers = userDataArray.filter(u => u.hoursWorked > 0).length;

		// Sort by revenue for top performers
		const topPerformers = userDataArray
			.filter(u => u.quotations?.revenue > 0)
			.sort((a, b) => (b.quotations?.revenue || 0) - (a.quotations?.revenue || 0))
			.slice(0, 5);

		// Low performers - users with minimal activity
		const lowPerformers = userDataArray
			.filter(u => u.hoursWorked < 2 && u.quotations?.count === 0)
			.slice(0, 5);

		// Calculate averages
		const averageMetrics = {
			hoursWorked: totalUsers > 0 ? userDataArray.reduce((sum, u) => sum + (u.hoursWorked || 0), 0) / totalUsers : 0,
			visits: totalUsers > 0 ? userDataArray.reduce((sum, u) => sum + (u.visits || 0), 0) / totalUsers : 0,
			revenue: totalUsers > 0 ? userDataArray.reduce((sum, u) => sum + (u.quotations?.revenue || 0), 0) / totalUsers : 0,
		};

		return {
			totalUsers,
			activeUsers,
			topPerformers,
			lowPerformers,
			averageMetrics: {
				hoursWorked: Math.round(averageMetrics.hoursWorked * 10) / 10,
				visits: Math.round(averageMetrics.visits * 10) / 10,
				revenue: Math.round(averageMetrics.revenue * 100) / 100,
			},
		};
	}
}
