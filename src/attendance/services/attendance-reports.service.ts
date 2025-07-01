import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { startOfDay, endOfDay, format, subDays, subBusinessDays, isValid } from 'date-fns';

import { Attendance } from '../entities/attendance.entity';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { OrganizationHoursService } from './organization-hours.service';
import { UserService } from '../../user/user.service';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { AccessLevel } from '../../lib/enums/user.enums';
import { EmailType } from '../../lib/enums/email.enums';
import { AccountStatus } from '../../lib/enums/status.enums';
import { TimeCalculatorUtil } from '../utils/time-calculator.util';

/**
 * AttendanceReportsService
 *
 * Automated attendance reporting system that sends daily attendance reports via email.
 *
 * Features:
 * - Morning reports: Sent 5 minutes after organization opening time
 * - Evening reports: Sent 30 minutes after organization closing time
 * - Smart scheduling: Respects each organization's working hours and holidays
 * - Comprehensive data: Includes attendance rates, punctuality breakdown, insights, and recommendations
 * - Recipients: Automatically sends to OWNER, ADMIN, and HR level users
 * - Duplicate prevention: Prevents sending multiple reports on the same day
 * - Email templates: Uses Handlebars templates for professional report formatting
 *
 * Cron schedules:
 * - Morning checks: Every minute (for accurate 5-minute timing)
 * - Evening checks: Every 30 minutes (sufficient for 30-minute delay)
 */

interface AttendanceReportUser {
	uid: number;
	name: string;
	surname: string;
	fullName: string;
	email: string;
	phone?: string;
	role: AccessLevel;
	userProfile?: {
		avatar?: string;
	};
	branch?: {
		uid: number;
		name: string;
	};
	lateMinutes?: number;
	earlyMinutes?: number;
	checkInTime?: string;
	lateStatus?: 'on-time' | 'late' | 'very-late' | 'extremely-late';
}

interface AttendanceSummary {
	totalEmployees: number;
	presentCount: number;
	absentCount: number;
	attendanceRate: number;
}

interface PunctualityBreakdown {
	earlyArrivals: AttendanceReportUser[];
	onTimeArrivals: AttendanceReportUser[];
	lateArrivals: AttendanceReportUser[];
	veryLateArrivals: AttendanceReportUser[];
	earlyPercentage: number;
	onTimePercentage: number;
	latePercentage: number;
	veryLatePercentage: number;
	averageLateMinutes: number;
	totalLateMinutes: number;
}

interface EmployeeAttendanceMetric {
	user: AttendanceReportUser;
	todayCheckIn: string | null;
	todayCheckOut: string | null;
	hoursWorked: number;
	isLate: boolean;
	lateMinutes: number;
	yesterdayHours: number;
	comparisonText: string;
	timingDifference: string;
}

interface MorningReportData {
	organizationName: string;
	reportDate: string;
	organizationStartTime: string;
	summary: AttendanceSummary;
	punctuality: PunctualityBreakdown;
	presentEmployees: AttendanceReportUser[];
	absentEmployees: AttendanceReportUser[];
	insights: string[];
	recommendations: string[];
	generatedAt: string;
	dashboardUrl: string;
	hasEmployees: boolean;
	latenessSummary: {
		totalLateEmployees: number;
		totalLateMinutes: number;
		averageLateMinutes: number;
		worstLateArrival: {
			employee: string;
			minutes: number;
		} | null;
	};
}

interface TemplateEmployeeMetric {
	uid: number;
	name: string;
	surname: string;
	email: string;
	role: string;
	branch?: {
		uid: number;
		name: string;
	};
	checkInTime: string | null;
	checkOutTime: string | null;
	hoursWorked: number;
	isLate: boolean;
	lateMinutes: number;
	status: string;
	yesterdayComparison: {
		hoursChange: number;
		punctualityChange: string;
	};
	avatar: string | null;
}

interface EveningReportData {
	organizationName: string;
	reportDate: string;
	organizationStartTime: string;
	organizationCloseTime: string;
	employeeMetrics: TemplateEmployeeMetric[];
	presentEmployees: AttendanceReportUser[];
	absentEmployees: AttendanceReportUser[];
	summary: {
		totalEmployees: number;
		completedShifts: number;
		averageHours: number;
		totalOvertimeMinutes: number;
	};
	insights: string[];
	hasEmployees: boolean;
	latenessSummary: {
		totalLateEmployees: number;
		totalLateMinutes: number;
		averageLateMinutes: number;
		punctualityTrend: string;
	};
	totalEmployees: number;
	workedTodayCount: number;
	totalHoursWorked: number;
	averageHoursWorked: number;
	attendanceChange: number;
	hoursChange: number;
	punctualityChange: number;
	performanceTrend: string;
	attendanceRate: number;
	yesterdayAttendanceRate: number;
	punctualityRate: number;
	overallPerformance: {
		description: string;
	};
	topPerformers: Array<{
		name: string;
		surname: string;
		hoursWorked: number;
		achievement: string;
		metric: string;
	}> | null;
	improvementAreas: Array<{
		area: string;
		description: string;
		count: number;
	}> | null;
	tomorrowActions: string[];
	generatedAt: string;
	dashboardUrl: string;
}

@Injectable()
export class AttendanceReportsService {
	private readonly logger = new Logger(AttendanceReportsService.name);

	constructor(
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		private readonly organizationHoursService: OrganizationHoursService,
		private readonly userService: UserService,
		private readonly eventEmitter: EventEmitter2,
	) {}

	/**
	 * Schedule morning reports to run every 5 minutes and check if it's time to send
	 * Reports are sent 5 minutes after each organization's opening time
	 * This allows for dynamic scheduling based on each organization's start time
	 */
	@Cron('*/5 * * * *') // Run every 5 minutes for optimal balance of accuracy and performance
	async checkAndSendMorningReports() {
		try {
			const now = new Date();
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
			});

			for (const org of organizations) {
				await this.processMorningReportForOrganization(org, now);
			}
		} catch (error) {
			this.logger.error('Error in checkAndSendMorningReports:', error);
		}
	}

	/**
	 * Schedule evening reports to run every 30 minutes and check if it's time to send
	 * Reports are sent 30 minutes after each organization's closing time
	 * This allows for dynamic scheduling based on each organization's end time
	 */
	@Cron('*/30 * * * *')
	async checkAndSendEveningReports() {
		try {
			const now = new Date();
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
			});

			for (const org of organizations) {
				await this.processEveningReportForOrganization(org, now);
			}
		} catch (error) {
			this.logger.error('Error in checkAndSendEveningReports:', error);
		}
	}

	private async processMorningReportForOrganization(organization: Organisation, currentTime: Date) {
		try {
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organization.uid, currentTime);

			if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime) {
				return; // Skip non-working days
			}

			// Calculate 5 minutes after start time
			const startTimeMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.startTime);
			const reportTimeMinutes = startTimeMinutes + 5;
			const currentTimeMinutes = TimeCalculatorUtil.timeToMinutes(currentTime.toTimeString().substring(0, 5));

			// Check if we're within 5 minutes of the report time (sufficient with 5-minute intervals)
			const timeDifference = Math.abs(currentTimeMinutes - reportTimeMinutes);
			if (timeDifference > 5) {
				return; // Not time yet or too late
			}

			// Check if we already sent a report today
			const today = startOfDay(currentTime);
			const cacheKey = `morning_report_${organization.uid}_${format(today, 'yyyy-MM-dd')}`;

			// Simple in-memory check - could be enhanced with Redis
			if (this.hasReportBeenSent(cacheKey)) {
				return;
			}

			await this.generateAndSendMorningReport(organization.uid);
			this.markReportAsSent(cacheKey);

			this.logger.log(`Morning report sent for organization ${organization.name} (ID: ${organization.uid})`);
		} catch (error) {
			this.logger.error(`Error processing morning report for organization ${organization.uid}:`, error);
		}
	}

	private async processEveningReportForOrganization(organization: Organisation, currentTime: Date) {
		try {
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organization.uid, currentTime);

			if (!workingDayInfo.isWorkingDay || !workingDayInfo.endTime) {
				return; // Skip non-working days
			}

			// Calculate 30 minutes after end time
			const endTimeMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.endTime);
			const reportTimeMinutes = endTimeMinutes + 30;
			const currentTimeMinutes = TimeCalculatorUtil.timeToMinutes(currentTime.toTimeString().substring(0, 5));

			// Check if we're within 5 minutes of the report time
			const timeDifference = Math.abs(currentTimeMinutes - reportTimeMinutes);
			if (timeDifference > 5) {
				return; // Not time yet or too late
			}

			// Check if we already sent a report today
			const today = startOfDay(currentTime);
			const cacheKey = `evening_report_${organization.uid}_${format(today, 'yyyy-MM-dd')}`;

			if (this.hasReportBeenSent(cacheKey)) {
				return;
			}

			await this.generateAndSendEveningReport(organization.uid);
			this.markReportAsSent(cacheKey);

			this.logger.log(`Evening report sent for organization ${organization.name} (ID: ${organization.uid})`);
		} catch (error) {
			this.logger.error(`Error processing evening report for organization ${organization.uid}:`, error);
		}
	}

	private reportCache = new Set<string>();

	private hasReportBeenSent(cacheKey: string): boolean {
		return this.reportCache.has(cacheKey);
	}

	private markReportAsSent(cacheKey: string): void {
		this.reportCache.add(cacheKey);
		// Clean up after 24 hours
		setTimeout(() => this.reportCache.delete(cacheKey), 24 * 60 * 60 * 1000);
	}

	/**
	 * Generate and send morning attendance report
	 */
	async generateAndSendMorningReport(organizationId: number): Promise<void> {
		try {
			const reportData = await this.generateMorningReportData(organizationId);
			const recipients = await this.getReportRecipients(organizationId);

			if (recipients.length === 0) {
				this.logger.warn(`No recipients found for morning report - Organization ID: ${organizationId}`);
				return;
			}

			this.eventEmitter.emit('send.email', EmailType.ATTENDANCE_MORNING_REPORT, recipients, reportData);

			this.logger.log(
				`Morning attendance report generated and sent for organization ${organizationId} to ${recipients.length} recipients`,
			);
		} catch (error) {
			this.logger.error(`Error generating morning report for organization ${organizationId}:`, error);
			throw error;
		}
	}

	/**
	 * Generate and send evening attendance report
	 */
	async generateAndSendEveningReport(organizationId: number): Promise<void> {
		try {
			const reportData = await this.generateEveningReportData(organizationId);
			const recipients = await this.getReportRecipients(organizationId);

			if (recipients.length === 0) {
				this.logger.warn(`No recipients found for evening report - Organization ID: ${organizationId}`);
				return;
			}

			this.eventEmitter.emit('send.email', EmailType.ATTENDANCE_EVENING_REPORT, recipients, reportData);

			this.logger.log(
				`Evening attendance report generated and sent for organization ${organizationId} to ${recipients.length} recipients`,
			);
		} catch (error) {
			this.logger.error(`Error generating evening report for organization ${organizationId}:`, error);
			throw error;
		}
	}

	private async generateMorningReportData(organizationId: number): Promise<MorningReportData> {
		const today = new Date();
		const startOfToday = startOfDay(today);
		const endOfToday = endOfDay(today);

		// Get organization info
		const organization = await this.organisationRepository.findOne({
			where: { uid: organizationId },
		});

		// Get working day info for organization hours with fallback
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, today);

		// Ensure we have valid start time with fallback
		const organizationStartTime = workingDayInfo.startTime || '09:00';

		// Get all users in the organization with better error handling
		let allUsers = [];
		let totalEmployees = 0;

		try {
			const usersResponse = await this.userService.findAll({ organisationId: organizationId }, 1, 1000);
			allUsers = usersResponse.data || [];
			totalEmployees = allUsers.length;
		} catch (error) {
			this.logger.warn(`Failed to fetch users for organization ${organizationId}:`, error);
		}

		// Get today's attendance records
		const todayAttendance = await this.attendanceRepository.find({
			where: {
				organisation: { uid: organizationId },
				checkIn: Between(startOfToday, endOfToday),
			},
			relations: ['owner', 'owner.userProfile', 'owner.branch'],
		});

		const presentCount = todayAttendance.length;
		const absentCount = totalEmployees - presentCount;
		const attendanceRate = totalEmployees > 0 ? (presentCount / totalEmployees) * 100 : 0;

		// Create present employees list
		const presentEmployees: AttendanceReportUser[] = todayAttendance.map((attendance) => {
			const owner = attendance.owner;
			const fullName = `${owner.name || ''} ${owner.surname || ''}`.trim();
			return {
				uid: owner.uid,
				name: owner.name || 'Unknown',
				surname: owner.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: owner.email || 'no-email@company.com',
				phone: owner.phone || undefined,
				role: owner.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: owner.photoURL || null,
				},
				branch: owner.branch
					? {
							uid: owner.branch.uid,
							name: owner.branch.name || 'Unknown Branch',
					  }
					: undefined,
				lateMinutes: undefined,
				earlyMinutes: undefined,
				checkInTime: attendance.checkIn ? format(attendance.checkIn, 'HH:mm') : undefined,
				lateStatus: undefined,
			};
		});

		// Create absent employees list
		const presentUserIds = new Set(todayAttendance.map((att) => att.owner?.uid));
		const absentEmployees: AttendanceReportUser[] = allUsers
			.filter((user) => !presentUserIds.has(user.uid))
			.map((user) => {
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				return {
					uid: user.uid,
					name: user.name || 'Unknown',
					surname: user.surname || 'User',
					fullName: fullName || 'Unknown User',
					email: user.email || 'no-email@company.com',
					phone: user.phone || undefined,
					role: user.accessLevel || AccessLevel.USER,
					userProfile: {
						avatar: user.photoURL || null,
					},
					branch: user.branch
						? {
								uid: user.branch.uid,
								name: user.branch.name || 'Unknown Branch',
						  }
						: undefined,
					lateMinutes: undefined,
					earlyMinutes: undefined,
					checkInTime: undefined,
					lateStatus: undefined,
				};
			});

		// Generate punctuality breakdown
		const punctuality = await this.generatePunctualityBreakdown(organizationId, todayAttendance);

		// Calculate comprehensive lateness summary
		const allLateEmployees = [...punctuality.lateArrivals, ...punctuality.veryLateArrivals];
		const worstLateArrival =
			allLateEmployees.length > 0
				? allLateEmployees.reduce((worst, emp) =>
						(emp.lateMinutes || 0) > (worst.lateMinutes || 0) ? emp : worst,
				  )
				: null;

		const latenessSummary = {
			totalLateEmployees: allLateEmployees.length,
			totalLateMinutes: punctuality.totalLateMinutes,
			averageLateMinutes: punctuality.averageLateMinutes,
			worstLateArrival: worstLateArrival
				? {
						employee: worstLateArrival.fullName,
						minutes: worstLateArrival.lateMinutes || 0,
				  }
				: null,
		};

		// Generate insights and recommendations with enhanced logic for no employees
		const insights = this.generateMorningInsights(attendanceRate, punctuality, presentCount, totalEmployees);
		const recommendations = this.generateMorningRecommendations(punctuality, attendanceRate);

		return {
			organizationName: organization?.name || 'Organization',
			reportDate: format(today, 'EEEE, MMMM do, yyyy'),
			organizationStartTime,
			summary: {
				totalEmployees,
				presentCount,
				absentCount,
				attendanceRate: Math.round(attendanceRate * 100) / 100,
			},
			punctuality,
			presentEmployees,
			absentEmployees,
			insights,
			recommendations,
			generatedAt: format(today, 'yyyy-MM-dd HH:mm:ss'),
			dashboardUrl: process.env.APP_URL || 'https://loro.co.za',
			hasEmployees: totalEmployees > 0,
			latenessSummary,
		};
	}

	private async generateEveningReportData(organizationId: number): Promise<EveningReportData> {
		const today = new Date();
		const startOfToday = startOfDay(today);
		const endOfToday = endOfDay(today);

		// Get organization info
		const organization = await this.organisationRepository.findOne({
			where: { uid: organizationId },
		});

		// Get working day info for organization hours with fallback
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, today);
		const organizationStartTime = workingDayInfo.startTime || '09:00';
		const organizationCloseTime = workingDayInfo.endTime || '17:00';

		// Get all users in the organization with better error handling
		let allUsers = [];

		try {
			const usersResponse = await this.userService.findAll({ organisationId: organizationId }, 1, 1000);
			allUsers = usersResponse.data || [];
		} catch (error) {
			this.logger.warn(`Failed to fetch users for organization ${organizationId}:`, error);
		}

		// Find the most recent working day for comparison (smart yesterday logic)
		const { comparisonDate, comparisonLabel } = await this.findLastWorkingDay(organizationId, today);
		const startOfComparison = startOfDay(comparisonDate);
		const endOfComparison = endOfDay(comparisonDate);

		// Get today's and comparison day's attendance records
		const [todayAttendance, comparisonAttendance] = await Promise.all([
			this.attendanceRepository.find({
				where: {
					organisation: { uid: organizationId },
					checkIn: Between(startOfToday, endOfToday),
				},
				relations: ['owner', 'owner.userProfile', 'owner.branch'],
			}),
			this.attendanceRepository.find({
				where: {
					organisation: { uid: organizationId },
					checkIn: Between(startOfComparison, endOfComparison),
				},
				relations: ['owner'],
			}),
		]);

		// Create present employees list
		const presentEmployees: AttendanceReportUser[] = todayAttendance.map((attendance) => {
			const owner = attendance.owner;
			const fullName = `${owner.name || ''} ${owner.surname || ''}`.trim();
			return {
				uid: owner.uid,
				name: owner.name || 'Unknown',
				surname: owner.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: owner.email || 'no-email@company.com',
				phone: owner.phone || undefined,
				role: owner.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: owner.photoURL || null,
				},
				branch: owner.branch
					? {
							uid: owner.branch.uid,
							name: owner.branch.name || 'Unknown Branch',
					  }
					: undefined,
				lateMinutes: undefined,
				earlyMinutes: undefined,
				checkInTime: attendance.checkIn ? format(attendance.checkIn, 'HH:mm') : undefined,
				lateStatus: undefined,
			};
		});

		// Create absent employees list
		const presentUserIds = new Set(todayAttendance.map((att) => att.owner?.uid));
		const absentEmployees: AttendanceReportUser[] = allUsers
			.filter((user) => !presentUserIds.has(user.uid))
			.map((user) => {
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				return {
					uid: user.uid,
					name: user.name || 'Unknown',
					surname: user.surname || 'User',
					fullName: fullName || 'Unknown User',
					email: user.email || 'no-email@company.com',
					phone: user.phone || undefined,
					role: user.accessLevel || AccessLevel.USER,
					userProfile: {
						avatar: user.photoURL || null,
					},
					branch: user.branch
						? {
								uid: user.branch.uid,
								name: user.branch.name || 'Unknown Branch',
						  }
						: undefined,
					lateMinutes: undefined,
					earlyMinutes: undefined,
					checkInTime: undefined,
					lateStatus: undefined,
				};
			});

		// Generate employee metrics with improved comparison logic
		const employeeMetrics = await this.generateEmployeeMetrics(
			organizationId,
			allUsers,
			todayAttendance,
			comparisonAttendance,
			comparisonLabel,
		);

		// Map employee metrics to template format
		const templateEmployeeMetrics = employeeMetrics.map((metric) => {
			// Determine employee status
			let status = 'Absent';
			if (metric.todayCheckIn) {
				if (metric.isLate) {
					status = 'Late';
				} else {
					status = 'On Time';
				}
				if (metric.todayCheckOut) {
					status = 'Completed';
				}
			}

			// Create yesterday comparison object
			const yesterdayComparison = {
				hoursChange: Math.round((metric.hoursWorked - metric.yesterdayHours) * 100) / 100,
				punctualityChange: metric.isLate ? 'worse' : metric.yesterdayHours === 0 ? 'new' : 'same',
			};

			return {
				uid: metric.user.uid,
				name: metric.user.name || 'Unknown',
				surname: metric.user.surname || 'User',
				email: metric.user.email || 'no-email@company.com',
				role: metric.user.role || 'Staff',
				branch: metric.user.branch,
				checkInTime: metric.todayCheckIn || null,
				checkOutTime: metric.todayCheckOut || null,
				hoursWorked: metric.hoursWorked || 0,
				isLate: metric.isLate || false,
				lateMinutes: metric.lateMinutes || 0,
				status,
				yesterdayComparison,
				avatar: metric.user.userProfile?.avatar || null,
			};
		});

		// Calculate summary statistics
		const completedShifts = todayAttendance.filter((a) => a.status === AttendanceStatus.COMPLETED).length;
		const totalHours = todayAttendance.reduce((sum, attendance) => {
			if (attendance.duration) {
				const minutes = this.parseDurationToMinutes(attendance.duration);
				return sum + minutes / 60;
			}
			return sum;
		}, 0);
		const avgHours = completedShifts > 0 ? totalHours / completedShifts : 0;

		const standardMinutes = workingDayInfo.expectedWorkMinutes;
		const totalOvertimeMinutes = todayAttendance.reduce((sum, attendance) => {
			if (attendance.duration) {
				const actualMinutes = this.parseDurationToMinutes(attendance.duration);
				return sum + Math.max(0, actualMinutes - standardMinutes);
			}
			return sum;
		}, 0);

		// Calculate comprehensive lateness summary for evening report
		const lateEmployeesToday = employeeMetrics.filter((metric) => metric.isLate);
		const totalLateMinutesToday = lateEmployeesToday.reduce((sum, metric) => sum + metric.lateMinutes, 0);
		const averageLateMinutesToday =
			lateEmployeesToday.length > 0
				? Math.round((totalLateMinutesToday / lateEmployeesToday.length) * 100) / 100
				: 0;

		// Determine punctuality trend
		let punctualityTrend = 'stable';
		const latePercentageToday =
			employeeMetrics.length > 0 ? (lateEmployeesToday.length / employeeMetrics.length) * 100 : 0;

		if (latePercentageToday === 0) {
			punctualityTrend = 'excellent - no late arrivals';
		} else if (latePercentageToday < 10) {
			punctualityTrend = 'good - minimal late arrivals';
		} else if (latePercentageToday < 25) {
			punctualityTrend = 'concerning - moderate late arrivals';
		} else {
			punctualityTrend = 'critical - high rate of late arrivals';
		}

		const latenessSummary = {
			totalLateEmployees: lateEmployeesToday.length,
			totalLateMinutes: totalLateMinutesToday,
			averageLateMinutes: averageLateMinutesToday,
			punctualityTrend,
		};

		// Calculate performance comparison with yesterday
		const workedTodayCount = presentEmployees.length;
		const comparisonWorkedCount = comparisonAttendance.length;
		const attendanceChange =
			comparisonWorkedCount > 0
				? Math.round(((workedTodayCount - comparisonWorkedCount) / comparisonWorkedCount) * 100)
				: 0;

		const comparisonTotalHours = comparisonAttendance.reduce((sum, attendance) => {
			if (attendance.duration) {
				const minutes = this.parseDurationToMinutes(attendance.duration);
				return sum + minutes / 60;
			}
			return sum;
		}, 0);
		const hoursChange = Math.round((totalHours - comparisonTotalHours) * 100) / 100;

		// Calculate punctuality change
		const comparisonLateCount = comparisonAttendance.filter((att) => {
			// Simple late check for comparison - could be enhanced
			return att.checkIn && new Date(att.checkIn).getHours() >= 9;
		}).length;
		const todayLateCount = lateEmployeesToday.length;
		const punctualityChange =
			comparisonAttendance.length > 0
				? Math.round(((comparisonLateCount - todayLateCount) / comparisonAttendance.length) * 100)
				: 0;

		// Determine performance trend
		let performanceTrend = 'stable';
		if (attendanceChange > 5 && hoursChange > 0) {
			performanceTrend = 'improving';
		} else if (attendanceChange < -5 || hoursChange < -2) {
			performanceTrend = 'declining';
		}

		// Generate insights with enhanced feedback
		const insights = this.generateEveningInsights(employeeMetrics, completedShifts, avgHours);

		// Generate tomorrow's action items
		const tomorrowActions = [];
		if (lateEmployeesToday.length > 0) {
			tomorrowActions.push(`Follow up with ${lateEmployeesToday.length} employees who arrived late today`);
		}
		if (absentEmployees.length > 0) {
			tomorrowActions.push(`Check in with ${absentEmployees.length} absent employees to ensure they're okay`);
		}
		if (avgHours < 6) {
			tomorrowActions.push('Review scheduling and workload distribution to improve productivity');
		}
		if (tomorrowActions.length === 0) {
			tomorrowActions.push('Continue maintaining excellent team performance and punctuality');
		}

		// Generate top performers
		const topPerformers = templateEmployeeMetrics
			.filter((emp) => emp.hoursWorked > 0)
			.sort((a, b) => b.hoursWorked - a.hoursWorked)
			.slice(0, 3)
			.map((emp) => ({
				name: emp.name,
				surname: emp.surname,
				hoursWorked: emp.hoursWorked,
				achievement: emp.hoursWorked >= 8 ? 'Full day completed' : 'Good performance',
				metric: 'hours',
			}));

		return {
			organizationName: organization?.name || 'Organization',
			reportDate: format(today, 'EEEE, MMMM do, yyyy'),
			organizationStartTime,
			organizationCloseTime,
			employeeMetrics: templateEmployeeMetrics, // Use the properly mapped metrics
			presentEmployees,
			absentEmployees,
			summary: {
				totalEmployees: allUsers.length,
				completedShifts,
				averageHours: Math.round(avgHours * 100) / 100,
				totalOvertimeMinutes: Math.round(totalOvertimeMinutes),
			},
			insights,
			hasEmployees: allUsers.length > 0,
			latenessSummary,
			// Add missing template fields
			totalEmployees: allUsers.length,
			workedTodayCount,
			totalHoursWorked: Math.round(totalHours * 100) / 100,
			averageHoursWorked: Math.round(avgHours * 100) / 100,
			attendanceChange,
			hoursChange,
			punctualityChange,
			performanceTrend,
			attendanceRate: Math.round((workedTodayCount / Math.max(allUsers.length, 1)) * 100),
			yesterdayAttendanceRate: Math.round((comparisonWorkedCount / Math.max(allUsers.length, 1)) * 100),
			punctualityRate:
				employeeMetrics.length > 0
					? Math.round(((employeeMetrics.length - lateEmployeesToday.length) / employeeMetrics.length) * 100)
					: 100,
			overallPerformance: {
				description:
					performanceTrend === 'improving'
						? 'Team performance is trending upward with good attendance and productivity'
						: performanceTrend === 'declining'
						? 'Performance needs attention - consider team check-ins and support'
						: 'Team performance is stable and consistent',
			},
			topPerformers: topPerformers.length > 0 ? topPerformers : null,
			improvementAreas:
				lateEmployeesToday.length > 0
					? [
							{
								area: 'Punctuality',
								description: `${lateEmployeesToday.length} employees arrived late today`,
								count: lateEmployeesToday.length,
							},
					  ]
					: null,
			tomorrowActions,
			generatedAt: format(today, 'PPpp'),
			dashboardUrl: process.env.DASHBOARD_URL || 'https://dashboard.loro.com',
		};
	}

	private async generatePunctualityBreakdown(
		organizationId: number,
		todayAttendance: Attendance[],
	): Promise<PunctualityBreakdown> {
		const earlyArrivals: AttendanceReportUser[] = [];
		const onTimeArrivals: AttendanceReportUser[] = [];
		const lateArrivals: AttendanceReportUser[] = [];
		const veryLateArrivals: AttendanceReportUser[] = [];

		for (const attendance of todayAttendance) {
			if (!attendance.owner || !attendance.checkIn || !isValid(attendance.checkIn)) {
				continue;
			}

			// Get late information and working day info
			const lateInfo = await this.organizationHoursService.isUserLate(organizationId, attendance.checkIn);
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
				organizationId,
				attendance.checkIn,
			);

			// Calculate early/late minutes
			let lateMinutes = 0;
			let earlyMinutes = 0;
			let lateStatus: 'on-time' | 'late' | 'very-late' | 'extremely-late' = 'on-time';

			if (workingDayInfo.startTime) {
				const checkInMinutes = TimeCalculatorUtil.timeToMinutes(
					attendance.checkIn.toTimeString().substring(0, 5),
				);
				const expectedStartMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.startTime);

				if (lateInfo.isLate) {
					lateMinutes = lateInfo.lateMinutes;
					// Categorize lateness severity
					if (lateMinutes >= 60) {
						lateStatus = 'extremely-late';
					} else if (lateMinutes >= 30) {
						lateStatus = 'very-late';
					} else {
						lateStatus = 'late';
					}
				} else if (checkInMinutes < expectedStartMinutes) {
					earlyMinutes = expectedStartMinutes - checkInMinutes;
				}
			}

			// Defensive user profile handling to prevent mix-ups
			const owner = attendance.owner;
			const fullName = `${owner.name || ''} ${owner.surname || ''}`.trim();
			const user: AttendanceReportUser = {
				uid: owner.uid,
				name: owner.name || 'Unknown',
				surname: owner.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: owner.email || 'no-email@company.com',
				phone: owner.phone || undefined,
				role: owner.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: owner.photoURL || null,
				},
				branch: owner.branch
					? {
							uid: owner.branch.uid,
							name: owner.branch.name || 'Unknown Branch',
					  }
					: undefined,
				lateMinutes: lateMinutes > 0 ? lateMinutes : undefined,
				earlyMinutes: earlyMinutes > 0 ? earlyMinutes : undefined,
				checkInTime: attendance.checkIn ? format(attendance.checkIn, 'HH:mm') : undefined,
				lateStatus,
			};

			if (!workingDayInfo.startTime) {
				onTimeArrivals.push(user);
				continue;
			}

			const checkInMinutes = TimeCalculatorUtil.timeToMinutes(attendance.checkIn.toTimeString().substring(0, 5));
			const expectedStartMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.startTime);

			if (lateInfo.isLate) {
				if (lateMinutes >= 30) {
					veryLateArrivals.push(user);
				} else {
					lateArrivals.push(user);
				}
			} else if (checkInMinutes < expectedStartMinutes) {
				earlyArrivals.push(user);
			} else {
				onTimeArrivals.push(user);
			}
		}

		const total = todayAttendance.length;
		const allLateArrivals = [...lateArrivals, ...veryLateArrivals];
		const totalLateMinutes = allLateArrivals.reduce((sum, emp) => sum + (emp.lateMinutes || 0), 0);
		const averageLateMinutes =
			allLateArrivals.length > 0 ? Math.round((totalLateMinutes / allLateArrivals.length) * 100) / 100 : 0;

		return {
			earlyArrivals,
			onTimeArrivals,
			lateArrivals,
			veryLateArrivals,
			earlyPercentage: total > 0 ? Math.round((earlyArrivals.length / total) * 100) : 0,
			onTimePercentage: total > 0 ? Math.round((onTimeArrivals.length / total) * 100) : 0,
			latePercentage: total > 0 ? Math.round((lateArrivals.length / total) * 100) : 0,
			veryLatePercentage: total > 0 ? Math.round((veryLateArrivals.length / total) * 100) : 0,
			averageLateMinutes,
			totalLateMinutes,
		};
	}

	private async generateEmployeeMetrics(
		organizationId: number,
		allUsers: Omit<User, 'password'>[],
		todayAttendance: Attendance[],
		comparisonAttendance: Attendance[],
		comparisonLabel: string = 'yesterday',
	): Promise<EmployeeAttendanceMetric[]> {
		const metrics: EmployeeAttendanceMetric[] = [];

		for (const user of allUsers) {
			const todayRecord = todayAttendance.find((a) => a.owner?.uid === user.uid);
			const comparisonRecord = comparisonAttendance.find((a) => a.owner?.uid === user.uid);

			const todayHours = todayRecord?.duration ? this.parseDurationToMinutes(todayRecord.duration) / 60 : 0;
			const comparisonHours = comparisonRecord?.duration
				? this.parseDurationToMinutes(comparisonRecord.duration) / 60
				: 0;

			let isLate = false;
			let lateMinutes = 0;

			if (todayRecord?.checkIn) {
				const lateInfo = await this.organizationHoursService.isUserLate(organizationId, todayRecord.checkIn);
				isLate = lateInfo.isLate;
				lateMinutes = lateInfo.lateMinutes;
			}

			const hoursDifference = todayHours - comparisonHours;
			let comparisonText = `Same as ${comparisonLabel}`;
			let timingDifference = '→';

			// Handle zero comparison hours with intelligent messaging
			if (comparisonHours === 0 && todayHours > 0) {
				comparisonText = `${Math.round(todayHours * 100) / 100}h worked (no data for ${comparisonLabel})`;
				timingDifference = '📊';
			} else if (comparisonHours === 0 && todayHours === 0) {
				comparisonText = `No work recorded for today or ${comparisonLabel}`;
				timingDifference = '⭕';
			} else if (hoursDifference > 0.5) {
				comparisonText = `${Math.round(hoursDifference * 100) / 100}h more than ${comparisonLabel}`;
				timingDifference = '↗️';
			} else if (hoursDifference < -0.5) {
				comparisonText = `${Math.round(Math.abs(hoursDifference) * 100) / 100}h less than ${comparisonLabel}`;
				timingDifference = '↘️';
			}

			// Defensive user profile creation to prevent data mix-ups
			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
			const reportUser: AttendanceReportUser = {
				uid: user.uid,
				name: user.name || 'Unknown',
				surname: user.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: user.email || 'no-email@company.com',
				phone: user.phone || undefined,
				role: user.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: user.photoURL || null,
				},
				branch: user.branch
					? {
							uid: user.branch.uid,
							name: user.branch.name || 'Unknown Branch',
					  }
					: undefined,
				lateMinutes: undefined,
				earlyMinutes: undefined,
				checkInTime: undefined,
				lateStatus: undefined,
			};

			metrics.push({
				user: reportUser,
				todayCheckIn: todayRecord?.checkIn ? format(todayRecord.checkIn, 'HH:mm') : null,
				todayCheckOut: todayRecord?.checkOut ? format(todayRecord.checkOut, 'HH:mm') : null,
				hoursWorked: Math.round(todayHours * 100) / 100,
				isLate,
				lateMinutes,
				yesterdayHours: Math.round(comparisonHours * 100) / 100,
				comparisonText,
				timingDifference,
			});
		}

		// Sort by hours worked (descending)
		return metrics.sort((a, b) => b.hoursWorked - a.hoursWorked);
	}

	private generateMorningInsights(
		attendanceRate: number,
		punctuality: PunctualityBreakdown,
		presentCount: number,
		totalEmployees: number,
	): string[] {
		const insights: string[] = [];

		// Special handling for no employees scenario
		if (totalEmployees === 0) {
			insights.push('No employees are registered in the system for this organization.');
			insights.push('System setup is required to begin tracking attendance and performance metrics.');
			return insights;
		}

		// Special handling for no present employees
		if (presentCount === 0) {
			insights.push('CRITICAL: No employees have checked in yet today. This requires immediate attention and follow-up.');
			insights.push('Potential causes: system issues, holiday schedules, communication gaps, or emergency situations.');
			insights.push('Immediate action required: Contact all team members to ensure safety and clarify work arrangements.');
			insights.push('Consider checking attendance system functionality and recent organizational communications.');
			return insights;
		}

		// Enhanced attendance rate insights
		if (attendanceRate >= 90) {
			insights.push(`Excellent attendance rate of ${attendanceRate}% - team showing strong commitment and engagement!`);
		} else if (attendanceRate >= 75) {
			insights.push(`Good attendance rate of ${attendanceRate}% with opportunity for improvement through enhanced team support.`);
		} else if (attendanceRate >= 50) {
			insights.push(`Moderate attendance rate of ${attendanceRate}% - investigate potential barriers preventing team attendance.`);
		} else {
			insights.push(`Low attendance rate of ${attendanceRate}% requires immediate intervention and comprehensive support strategy.`);
		}

		// Enhanced punctuality insights with comprehensive data
		const totalLatePercentage = punctuality.latePercentage + punctuality.veryLatePercentage;
		const totalOnTimePercentage = punctuality.earlyPercentage + punctuality.onTimePercentage;

		if (totalLatePercentage === 0 && presentCount > 0) {
			insights.push(`Perfect punctuality: All ${presentCount} employees arrived on time or early - exceptional team discipline!`);
		} else if (punctuality.veryLateArrivals.length > 0) {
			insights.push(
				`URGENT: ${punctuality.veryLateArrivals.length} employees arrived very late (30+ minutes). Total tardiness: ${totalLatePercentage}% with average delay of ${punctuality.averageLateMinutes} minutes.`,
			);
		} else if (punctuality.lateArrivals.length > 0) {
			insights.push(
				`${punctuality.lateArrivals.length} employees arrived late today with an average delay of ${punctuality.averageLateMinutes} minutes. Focus on identifying and addressing barriers.`,
			);
		}

		// Early arrival recognition
		if (punctuality.earlyArrivals.length > 0) {
			insights.push(`Outstanding dedication: ${punctuality.earlyArrivals.length} employees arrived early, demonstrating exceptional commitment.`);
		}

		// Specific insights for severe lateness requiring immediate action
		if (punctuality.veryLatePercentage > 10) {
			insights.push(
				`CRITICAL ALERT: ${punctuality.veryLatePercentage}% of employees were extremely late - immediate management intervention needed.`,
			);
		}

		// Present employee count insight
		if (presentCount > 0) {
			const presentPercentage = Math.round((presentCount / totalEmployees) * 100);
			insights.push(`${presentCount} out of ${totalEmployees} team members (${presentPercentage}%) have successfully checked in so far today.`);
		}

		// Performance comparison insight
		if (totalOnTimePercentage >= 80) {
			insights.push(`Strong punctuality performance: ${totalOnTimePercentage}% of attendees arrived on time or early.`);
		} else if (totalOnTimePercentage >= 60) {
			insights.push(`Moderate punctuality performance: ${totalOnTimePercentage}% of attendees arrived on time or early - room for improvement.`);
		} else if (totalOnTimePercentage > 0) {
			insights.push(`Punctuality challenges: Only ${totalOnTimePercentage}% of attendees arrived on time or early - requires focused attention.`);
		}

		return insights;
	}

	private generateMorningRecommendations(punctuality: PunctualityBreakdown, attendanceRate: number): string[] {
		const recommendations: string[] = [];

		// Special handling for zero attendance - immediate crisis response
		if (attendanceRate === 0) {
			recommendations.push('IMMEDIATE ACTION: Contact all team members within 30 minutes to verify safety and work status.');
			recommendations.push('Check attendance system functionality and verify no technical issues are preventing check-ins.');
			recommendations.push('Review today\'s schedule, holiday calendar, and recent organizational communications.');
			recommendations.push('Prepare contingency plans for business operations if attendance issues persist.');
			recommendations.push('Document incident for analysis and implement preventive measures for future occurrences.');
			return recommendations;
		}

		// Critical lateness recommendations
		if (punctuality.veryLateArrivals.length > 0) {
			recommendations.push(`URGENT: Schedule immediate meetings with ${punctuality.veryLateArrivals.length} employees who were very late to identify critical barriers.`);
			recommendations.push('Implement emergency support measures for employees facing significant attendance challenges.');
		}

		// Standard lateness recommendations
		if (punctuality.lateArrivals.length > 0) {
			recommendations.push('Schedule one-on-one conversations with late employees to understand barriers and provide targeted support.');
			recommendations.push('Review if start times and expectations are clearly communicated and realistic for all team members.');
			recommendations.push('Consider flexible start time options for employees facing consistent transportation or personal challenges.');
		}

		// Attendance improvement recommendations
		if (attendanceRate < 80) {
			recommendations.push('Implement proactive wellness check system to identify and address attendance barriers early.');
			recommendations.push('Review organizational policies and support systems to ensure they meet current team needs.');
		}

		if (attendanceRate < 60) {
			recommendations.push('Conduct urgent team meeting to address systemic attendance challenges and gather feedback.');
			recommendations.push('Consider implementing attendance incentive programs or enhanced support services.');
		}

		// Severe punctuality recommendations
		if (punctuality.latePercentage > 25) {
			recommendations.push('Evaluate and adjust start time expectations based on realistic commute and preparation needs.');
			recommendations.push('Implement attendance coaching program for employees struggling with punctuality.');
		}

		// Recognition and positive reinforcement
		if (punctuality.earlyArrivals.length > 0) {
			recommendations.push(`Recognize and appreciate the ${punctuality.earlyArrivals.length} employees who demonstrated exceptional commitment by arriving early.`);
		}

		if (punctuality.onTimeArrivals.length > 0) {
			recommendations.push(`Acknowledge the ${punctuality.onTimeArrivals.length} punctual team members for their consistent reliability and professionalism.`);
		}

		// Excellence maintenance recommendations
		if (punctuality.onTimePercentage > 80 && attendanceRate > 85) {
			recommendations.push('Continue current successful practices and consider documenting what\'s working well for future reference.');
			recommendations.push('Use today\'s positive performance as a benchmark for maintaining excellence.');
		}

		// Default positive reinforcement
		if (recommendations.length === 0) {
			recommendations.push('Maintain current excellent attendance practices and continue supporting team success.');
			recommendations.push('Consider sharing today\'s positive results with the team to reinforce good habits.');
		}

		return recommendations;
	}

	private generateEveningInsights(
		employeeMetrics: EmployeeAttendanceMetric[],
		completedShifts: number,
		avgHours: number,
	): string[] {
		const insights: string[] = [];

		// Special handling for no employees
		if (employeeMetrics.length === 0) {
			insights.push('No employee data available for this organization.');
			return insights;
		}

		const lateEmployees = employeeMetrics.filter((m) => m.isLate).length;
		const highPerformers = employeeMetrics.filter((m) => m.hoursWorked > avgHours + 1).length;
		const noCheckOut = employeeMetrics.filter((m) => m.todayCheckIn && !m.todayCheckOut).length;

		// Special handling for no attendance
		if (completedShifts === 0 && employeeMetrics.every((m) => !m.todayCheckIn)) {
			insights.push('No employees checked in today. Consider following up with your team.');
			insights.push('This could indicate a system issue, public holiday, or scheduling changes.');
			return insights;
		}

		if (completedShifts > 0) {
			insights.push(`${completedShifts} employees completed their shifts today.`);
		}

		if (avgHours > 0) {
			insights.push(`Average working hours: ${Math.round(avgHours * 100) / 100} hours.`);
		}

		if (lateEmployees > 0) {
			const totalLateMinutes = employeeMetrics.filter((m) => m.isLate).reduce((sum, m) => sum + m.lateMinutes, 0);
			const avgLateMinutes = totalLateMinutes / lateEmployees;
			insights.push(
				`${lateEmployees} employees arrived late today, averaging ${Math.round(avgLateMinutes)} minutes late.`,
			);
		}

		if (highPerformers > 0) {
			insights.push(`${highPerformers} employees worked above average hours.`);
		}

		if (noCheckOut > 0) {
			insights.push(`${noCheckOut} employees haven't checked out yet.`);
		}

		return insights;
	}

	/**
	 * Find the last working day for comparison, accounting for weekends and organization schedule
	 */
	private async findLastWorkingDay(
		organizationId: number,
		currentDate: Date,
	): Promise<{
		comparisonDate: Date;
		comparisonLabel: string;
	}> {
		let comparisonDate = subDays(currentDate, 1);
		let daysBack = 1;
		const maxDaysBack = 7; // Limit search to avoid infinite loops

		// First, try to find the last working day based on organization schedule
		while (daysBack <= maxDaysBack) {
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
				organizationId,
				comparisonDate,
			);

			if (workingDayInfo.isWorkingDay) {
				const label =
					daysBack === 1 ? 'yesterday' : daysBack === 2 ? 'day before yesterday' : `${daysBack} days ago`;
				return { comparisonDate, comparisonLabel: label };
			}

			daysBack++;
			comparisonDate = subDays(currentDate, daysBack);
		}

		// Fallback to business days if organization schedule isn't available
		try {
			comparisonDate = subBusinessDays(currentDate, 1);
			return { comparisonDate, comparisonLabel: 'last business day' };
		} catch (error) {
			// Ultimate fallback to yesterday
			return {
				comparisonDate: subDays(currentDate, 1),
				comparisonLabel: 'yesterday (may not be a working day)',
			};
		}
	}

	private async getReportRecipients(organizationId: number): Promise<string[]> {
		try {
			// Get users with OWNER, ADMIN, or HR access levels for the organization
			const ownerResult = await this.userService.findAll({
				organisationId: organizationId,
				accessLevel: AccessLevel.OWNER,
				status: AccountStatus.ACTIVE,
			});

			const adminResult = await this.userService.findAll({
				organisationId: organizationId,
				accessLevel: AccessLevel.ADMIN,
				status: AccountStatus.ACTIVE,
			});

			const hrResult = await this.userService.findAll({
				organisationId: organizationId,
				accessLevel: AccessLevel.HR,
				status: AccountStatus.ACTIVE,
			});

			// Combine all recipients
			const allRecipients = [...(ownerResult.data || []), ...(adminResult.data || []), ...(hrResult.data || [])];

			// Remove duplicates and filter for valid emails
			const uniqueRecipients = allRecipients.filter(
				(user, index, self) => user.email && self.findIndex((u) => u.uid === user.uid) === index,
			);

			return uniqueRecipients.map((user) => user.email);
		} catch (error) {
			this.logger.error(`Error getting report recipients for organization ${organizationId}:`, error);
			return [];
		}
	}

	/**
	 * Enhanced duration parser with multiple format support and validation
	 */
	private parseDurationToMinutes(duration: string): number {
		if (!duration || typeof duration !== 'string') return 0;

		const trimmed = duration.trim();
		if (trimmed === '0' || trimmed === '') return 0;

		try {
			// Handle format like "8h 30m", "8 hours 30 minutes", "8:30", etc.

			// Format: "HH:MM:SS" or "HH:MM"
			const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
			if (timeMatch) {
				const hours = parseInt(timeMatch[1], 10) || 0;
				const minutes = parseInt(timeMatch[2], 10) || 0;
				const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) || 0 : 0;
				return hours * 60 + minutes + Math.round(seconds / 60);
			}

			// Format: "8h 30m" or "8 hours 30 minutes" (flexible)
			const hourMinuteMatch = trimmed.match(
				/(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?/i,
			);
			if (hourMinuteMatch) {
				const hours = parseFloat(hourMinuteMatch[1]) || 0;
				const minutes = parseFloat(hourMinuteMatch[2]) || 0;
				return Math.round(hours * 60 + minutes);
			}

			// Format: just hours "8h" or "8 hours"
			const hourOnlyMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?$/i);
			if (hourOnlyMatch) {
				const hours = parseFloat(hourOnlyMatch[1]) || 0;
				return Math.round(hours * 60);
			}

			// Format: just minutes "45m" or "45 minutes"
			const minuteOnlyMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?$/i);
			if (minuteOnlyMatch) {
				const minutes = parseFloat(minuteOnlyMatch[1]) || 0;
				return Math.round(minutes);
			}

			// Format: decimal hours "8.5"
			const decimalMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
			if (decimalMatch) {
				const hours = parseFloat(decimalMatch[1]) || 0;
				return Math.round(hours * 60);
			}

			// Fallback: try to extract any numbers and assume they're hours
			const numbers = trimmed.match(/\d+(?:\.\d+)?/g);
			if (numbers && numbers.length > 0) {
				const firstNumber = parseFloat(numbers[0]) || 0;
				// If it's a reasonable hour value (0-24), treat as hours
				if (firstNumber <= 24) {
					return Math.round(firstNumber * 60);
				}
				// Otherwise, treat as minutes
				return Math.round(firstNumber);
			}

			this.logger.warn(`Unable to parse duration string: "${duration}"`);
			return 0;
		} catch (error) {
			this.logger.error(`Error parsing duration "${duration}":`, error);
			return 0;
		}
	}
}
