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
	totalActualHours: number;
	totalExpectedHours: number;
	productivityRate: number;
	hoursDeficit: number;
}

interface BranchPunctuality {
	branchId: number;
	branchName: string;
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
	totalEmployees: number;
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
	byBranch: BranchPunctuality[];
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

interface BranchSummary {
	branchId: number;
	branchName: string;
	presentEmployees: AttendanceReportUser[];
	absentEmployees: AttendanceReportUser[];
	currentlyWorkingEmployees: AttendanceReportUser[];
	completedShiftEmployees: AttendanceReportUser[];
	attendanceRate: number;
	totalEmployees: number;
	totalHoursWorked: number;
	averageHoursWorked: number;
}

interface MorningReportData {
	organizationName: string;
	reportDate: string;
	organizationStartTime: string;
	summary: AttendanceSummary;
	punctuality: PunctualityBreakdown;
	presentEmployees: AttendanceReportUser[];
	absentEmployees: AttendanceReportUser[];
	currentlyWorkingEmployees: AttendanceReportUser[];
	completedShiftEmployees: AttendanceReportUser[];
	branchBreakdown: BranchSummary[];
	targetPerformance: {
		expectedDailyHours: number;
		actualHoursToDate: number;
		projectedEndOfDayHours: number;
		onTrackToMeetTargets: boolean;
		targetAchievementRate: number;
		hoursGapAnalysis: string;
	};
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
	currentlyWorkingEmployees: AttendanceReportUser[];
	completedShiftEmployees: AttendanceReportUser[];
	overtimeEmployees: AttendanceReportUser[];
	branchBreakdown: BranchSummary[];
	targetPerformance: {
		expectedDailyHours: number;
		actualTotalHours: number;
		targetAchievementRate: number;
		hoursOverTarget: number;
		hoursUnderTarget: number;
		teamEfficiencyRating: string;
		individualTargetsMet: number;
		individualTargetsMissed: number;
	};
	summary: {
		totalEmployees: number;
		completedShifts: number;
		averageHours: number;
		totalOvertimeMinutes: number;
		totalActualHours: number;
		totalExpectedHours: number;
		productivityRate: number;
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
	const organizationStartTime = workingDayInfo.startTime || '07:30';

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

		// Get user targets for productivity analysis
		const userTargets = await this.getUserTargetsForOrganization(organizationId);

		// Calculate real-time total hours worked (including people still working)
		const totalActualHours = todayAttendance.reduce((sum, attendance) => {
			return sum + this.calculateRealTimeHours(attendance, today);
		}, 0);

		const presentCount = todayAttendance.length;
		const absentCount = totalEmployees - presentCount;
		const attendanceRate = totalEmployees > 0 ? (presentCount / totalEmployees) * 100 : 0;

		// Enhanced employee categorization
		const employeeCategories = this.categorizeEmployeesByStatus(allUsers, todayAttendance, today);

		// Generate punctuality breakdown
		const punctuality = await this.generatePunctualityBreakdown(organizationId, todayAttendance);

		// Generate branch breakdown
		const branchBreakdown = this.generateBranchBreakdown(allUsers, todayAttendance, today);

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

		// Calculate target performance metrics
		const expectedDailyHours = userTargets.totalExpectedDailyHours;
		const productivityRate = expectedDailyHours > 0 ? (totalActualHours / expectedDailyHours) * 100 : 0;
		const hoursDeficit = Math.max(0, expectedDailyHours - totalActualHours);

		// Project end-of-day hours based on current working patterns
		const currentTime = today;
		const workDayProgress = this.calculateWorkDayProgress(currentTime, organizationStartTime);
		const projectedEndOfDayHours = workDayProgress > 0 ? totalActualHours / workDayProgress : totalActualHours;
		
		const targetPerformance = {
			expectedDailyHours: Math.round(expectedDailyHours * 100) / 100,
			actualHoursToDate: Math.round(totalActualHours * 100) / 100,
			projectedEndOfDayHours: Math.round(projectedEndOfDayHours * 100) / 100,
			onTrackToMeetTargets: projectedEndOfDayHours >= expectedDailyHours * 0.9, // 90% threshold
			targetAchievementRate: Math.round(productivityRate * 100) / 100,
			hoursGapAnalysis: hoursDeficit > 0 
				? `${Math.round(hoursDeficit * 100) / 100} hours behind target`
				: 'On track or ahead of target'
		};

		// Generate enhanced insights and recommendations
		const insights = this.generateEnhancedMorningInsights(
			attendanceRate, 
			punctuality, 
			presentCount, 
			totalEmployees,
			targetPerformance,
			employeeCategories
		);
		const recommendations = this.generateEnhancedMorningRecommendations(
			punctuality, 
			attendanceRate,
			targetPerformance,
			employeeCategories
		);

		return {
			organizationName: organization?.name || 'Organization',
			reportDate: format(today, 'EEEE, MMMM do, yyyy'),
			organizationStartTime,
			summary: {
				totalEmployees,
				presentCount,
				absentCount,
				attendanceRate: Math.round(attendanceRate * 100) / 100,
				totalActualHours: Math.round(totalActualHours * 100) / 100,
				totalExpectedHours: Math.round(expectedDailyHours * 100) / 100,
				productivityRate: Math.round(productivityRate * 100) / 100,
				hoursDeficit: Math.round(hoursDeficit * 100) / 100,
			},
			punctuality,
			presentEmployees: employeeCategories.presentEmployees,
			absentEmployees: employeeCategories.absentEmployees,
			currentlyWorkingEmployees: employeeCategories.currentlyWorkingEmployees,
			completedShiftEmployees: employeeCategories.completedShiftEmployees,
			branchBreakdown,
			targetPerformance,
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
		const organizationStartTime = workingDayInfo.startTime || '07:30';
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

		// Get user targets for productivity analysis
		const userTargets = await this.getUserTargetsForOrganization(organizationId);

		// Enhanced employee categorization with real-time hours
		const employeeCategories = this.categorizeEmployeesByStatus(allUsers, todayAttendance, today);

		// Generate branch breakdown
		const branchBreakdown = this.generateBranchBreakdown(allUsers, todayAttendance, today);

		// Calculate real-time total hours worked (including people still working)
		const totalActualHours = todayAttendance.reduce((sum, attendance) => {
			return sum + this.calculateRealTimeHours(attendance, today);
		}, 0);

		// Generate employee metrics with improved comparison logic
		const employeeMetrics = await this.generateEmployeeMetrics(
			organizationId,
			allUsers,
			todayAttendance,
			comparisonAttendance,
			comparisonLabel,
		);

		// Map employee metrics to template format with enhanced real-time hours
		const templateEmployeeMetrics = employeeMetrics.map((metric) => {
			const todayRecord = todayAttendance.find((a) => a.owner?.uid === metric.user.uid);
			const realTimeHours = todayRecord ? this.calculateRealTimeHours(todayRecord, today) : 0;

			// Determine employee status with real-time consideration
			let status = 'Absent';
			if (metric.todayCheckIn) {
				if (metric.isLate) {
					status = 'Late';
				} else {
					status = 'On Time';
				}
				if (metric.todayCheckOut) {
					status = 'Completed';
				} else if (realTimeHours > 0) {
					status = 'Currently Working';
				}
			}

			// Create yesterday comparison object
			const yesterdayComparison = {
				hoursChange: Math.round((realTimeHours - metric.yesterdayHours) * 100) / 100,
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
				hoursWorked: Math.round(realTimeHours * 100) / 100, // Use real-time hours
				isLate: metric.isLate || false,
				lateMinutes: metric.lateMinutes || 0,
				status,
				yesterdayComparison,
				avatar: metric.user.userProfile?.avatar || null,
			};
		});

		// Calculate summary statistics with real-time hours
		const completedShifts = todayAttendance.filter((a) => a.status === AttendanceStatus.COMPLETED).length;
		const avgHours = employeeCategories.presentEmployees.length > 0 ? totalActualHours / employeeCategories.presentEmployees.length : 0;

		const standardMinutes = workingDayInfo.expectedWorkMinutes;
		const totalOvertimeMinutes = todayAttendance.reduce((sum, attendance) => {
			const realTimeHours = this.calculateRealTimeHours(attendance, today);
			const standardHours = standardMinutes / 60;
			return sum + Math.max(0, (realTimeHours - standardHours) * 60);
		}, 0);

		// Calculate target performance metrics
		const expectedDailyHours = userTargets.totalExpectedDailyHours;
		const productivityRate = expectedDailyHours > 0 ? (totalActualHours / expectedDailyHours) * 100 : 0;
		const hoursOverTarget = Math.max(0, totalActualHours - expectedDailyHours);
		const hoursUnderTarget = Math.max(0, expectedDailyHours - totalActualHours);

		// Calculate individual target achievements
		let individualTargetsMet = 0;
		let individualTargetsMissed = 0;

		templateEmployeeMetrics.forEach(emp => {
			const userTarget = userTargets.userTargetsMap.get(emp.uid) || 8;
			if (emp.hoursWorked >= userTarget * 0.9) { // 90% threshold
				individualTargetsMet++;
			} else {
				individualTargetsMissed++;
			}
		});

		// Determine team efficiency rating
		let teamEfficiencyRating = 'Poor';
		if (productivityRate >= 95) {
			teamEfficiencyRating = 'Excellent';
		} else if (productivityRate >= 85) {
			teamEfficiencyRating = 'Good';
		} else if (productivityRate >= 75) {
			teamEfficiencyRating = 'Fair';
		}

		const targetPerformance = {
			expectedDailyHours: Math.round(expectedDailyHours * 100) / 100,
			actualTotalHours: Math.round(totalActualHours * 100) / 100,
			targetAchievementRate: Math.round(productivityRate * 100) / 100,
			hoursOverTarget: Math.round(hoursOverTarget * 100) / 100,
			hoursUnderTarget: Math.round(hoursUnderTarget * 100) / 100,
			teamEfficiencyRating,
			individualTargetsMet,
			individualTargetsMissed,
		};

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
		const workedTodayCount = employeeCategories.presentEmployees.length;
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
		const hoursChange = Math.round((totalActualHours - comparisonTotalHours) * 100) / 100;

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

		// Generate enhanced insights with target analysis
		const insights = this.generateEnhancedEveningInsights(
			employeeMetrics, 
			completedShifts, 
			avgHours,
			targetPerformance,
			employeeCategories
		);

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
			presentEmployees: employeeCategories.presentEmployees,
			absentEmployees: employeeCategories.absentEmployees,
			currentlyWorkingEmployees: employeeCategories.currentlyWorkingEmployees,
			completedShiftEmployees: employeeCategories.completedShiftEmployees,
			overtimeEmployees: employeeCategories.overtimeEmployees,
			branchBreakdown,
			targetPerformance,
			summary: {
				totalEmployees: allUsers.length,
				completedShifts,
				averageHours: Math.round(avgHours * 100) / 100,
				totalOvertimeMinutes: Math.round(totalOvertimeMinutes),
				totalActualHours: Math.round(totalActualHours * 100) / 100,
				totalExpectedHours: Math.round(expectedDailyHours * 100) / 100,
				productivityRate: Math.round(productivityRate * 100) / 100,
			},
			insights,
			hasEmployees: allUsers.length > 0,
			latenessSummary,
			// Add missing template fields
			totalEmployees: allUsers.length,
			workedTodayCount,
			totalHoursWorked: Math.round(totalActualHours * 100) / 100,
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

		// Calculate branch-wise breakdown
		const branchMap = new Map<number, BranchPunctuality>();
		const allEmployees = [...earlyArrivals, ...onTimeArrivals, ...lateArrivals, ...veryLateArrivals];

		// Initialize branch data
		allEmployees.forEach(employee => {
			if (employee.branch) {
				const branchId = employee.branch.uid;
				if (!branchMap.has(branchId)) {
					branchMap.set(branchId, {
						branchId,
						branchName: employee.branch.name,
						earlyArrivals: [],
						onTimeArrivals: [],
						lateArrivals: [],
						veryLateArrivals: [],
						earlyPercentage: 0,
						onTimePercentage: 0,
						latePercentage: 0,
						veryLatePercentage: 0,
						averageLateMinutes: 0,
						totalLateMinutes: 0,
						totalEmployees: 0,
					});
				}
			}
		});

		// Group employees by branch and category
		earlyArrivals.forEach(emp => emp.branch && branchMap.get(emp.branch.uid)?.earlyArrivals.push(emp));
		onTimeArrivals.forEach(emp => emp.branch && branchMap.get(emp.branch.uid)?.onTimeArrivals.push(emp));
		lateArrivals.forEach(emp => emp.branch && branchMap.get(emp.branch.uid)?.lateArrivals.push(emp));
		veryLateArrivals.forEach(emp => emp.branch && branchMap.get(emp.branch.uid)?.veryLateArrivals.push(emp));

		// Calculate percentages and metrics for each branch
		const byBranch: BranchPunctuality[] = Array.from(branchMap.values()).map(branch => {
			const branchTotal = branch.earlyArrivals.length + branch.onTimeArrivals.length + 
				branch.lateArrivals.length + branch.veryLateArrivals.length;
			
			const branchLateEmployees = [...branch.lateArrivals, ...branch.veryLateArrivals];
			const branchTotalLateMinutes = branchLateEmployees.reduce((sum, emp) => sum + (emp.lateMinutes || 0), 0);
			const branchAverageLateMinutes = branchLateEmployees.length > 0 
				? Math.round((branchTotalLateMinutes / branchLateEmployees.length) * 100) / 100 
				: 0;

			return {
				...branch,
				totalEmployees: branchTotal,
				earlyPercentage: branchTotal > 0 ? Math.round((branch.earlyArrivals.length / branchTotal) * 100) : 0,
				onTimePercentage: branchTotal > 0 ? Math.round((branch.onTimeArrivals.length / branchTotal) * 100) : 0,
				latePercentage: branchTotal > 0 ? Math.round((branch.lateArrivals.length / branchTotal) * 100) : 0,
				veryLatePercentage: branchTotal > 0 ? Math.round((branch.veryLateArrivals.length / branchTotal) * 100) : 0,
				averageLateMinutes: branchAverageLateMinutes,
				totalLateMinutes: branchTotalLateMinutes,
			};
		});

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
			byBranch: byBranch.sort((a, b) => a.branchName.localeCompare(b.branchName)),
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

			// Enhanced comparison logic to handle edge cases and provide meaningful insights
			if (comparisonHours === 0 && todayHours === 0) {
				// Both days have zero hours - not really "same as yesterday"
				comparisonText = `No work recorded today or ${comparisonLabel}`;
				timingDifference = '⭕';
			} else if (comparisonHours === 0 && todayHours > 0) {
				// Today has work but yesterday didn't - this is new activity, not improvement
				if (todayHours >= 6) {
					comparisonText = `New activity: ${Math.round(todayHours * 100) / 100}h worked (no ${comparisonLabel} data)`;
					timingDifference = '🆕';
				} else {
					comparisonText = `${Math.round(todayHours * 100) / 100}h worked (no ${comparisonLabel} data)`;
					timingDifference = '📊';
				}
			} else if (todayHours === 0 && comparisonHours > 0) {
				// Today has no work but yesterday did - this is absence, not decline
				comparisonText = `No work today (worked ${Math.round(comparisonHours * 100) / 100}h ${comparisonLabel})`;
				timingDifference = '❌';
			} else if (Math.abs(hoursDifference) < 0.1) {
				// Very small difference (less than 6 minutes) - consider it the same
				comparisonText = `Consistent: ${Math.round(todayHours * 100) / 100}h (similar to ${comparisonLabel})`;
				timingDifference = '📍';
			} else if (hoursDifference > 0.5) {
				// Meaningful increase
				const increasePercent = Math.round(((hoursDifference) / comparisonHours) * 100);
				if (increasePercent >= 50) {
					comparisonText = `Strong increase: +${Math.round(hoursDifference * 100) / 100}h (+${increasePercent}% vs ${comparisonLabel})`;
					timingDifference = '📈';
				} else {
					comparisonText = `+${Math.round(hoursDifference * 100) / 100}h more than ${comparisonLabel}`;
					timingDifference = '↗️';
				}
			} else if (hoursDifference < -0.5) {
				// Meaningful decrease
				const decreasePercent = Math.round((Math.abs(hoursDifference) / comparisonHours) * 100);
				if (decreasePercent >= 50) {
					comparisonText = `Significant decrease: ${Math.round(Math.abs(hoursDifference) * 100) / 100}h less (-${decreasePercent}% vs ${comparisonLabel})`;
					timingDifference = '📉';
				} else {
					comparisonText = `${Math.round(Math.abs(hoursDifference) * 100) / 100}h less than ${comparisonLabel}`;
					timingDifference = '↘️';
				}
			} else {
				// Small difference (0.1 to 0.5 hours) - acknowledge but don't overstate
				if (hoursDifference > 0) {
					comparisonText = `Slightly more: +${Math.round(hoursDifference * 100) / 100}h vs ${comparisonLabel}`;
					timingDifference = '↗️';
				} else {
					comparisonText = `Slightly less: ${Math.round(Math.abs(hoursDifference) * 100) / 100}h vs ${comparisonLabel}`;
					timingDifference = '↘️';
				}
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

		// Sort by hours worked (descending), then by punctuality (on-time first)
		return metrics.sort((a, b) => {
			if (b.hoursWorked !== a.hoursWorked) {
				return b.hoursWorked - a.hoursWorked;
			}
			// If hours are equal, prioritize punctual employees
			if (a.isLate !== b.isLate) {
				return a.isLate ? 1 : -1;
			}
			return 0;
		});
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

		// Enhanced attendance rate insights with proper context
		const attendanceContext = totalEmployees > 1 ? 'team' : 'employee';
		if (attendanceRate >= 95) {
			insights.push(`Exceptional attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - outstanding commitment!`);
		} else if (attendanceRate >= 85) {
			insights.push(`Strong attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - excellent performance with minor room for improvement.`);
		} else if (attendanceRate >= 70) {
			insights.push(`Good attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - solid foundation with opportunities to enhance team engagement.`);
		} else if (attendanceRate >= 50) {
			insights.push(`Moderate attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - significant opportunity for improvement through targeted support.`);
		} else if (attendanceRate > 0) {
			insights.push(`Low attendance: Only ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - requires immediate intervention and comprehensive strategy.`);
		}

		// Enhanced punctuality insights with meaningful context
		const totalLateEmployees = punctuality.lateArrivals.length + punctuality.veryLateArrivals.length;
		const totalOnTimeEmployees = punctuality.earlyArrivals.length + punctuality.onTimeArrivals.length;
		
		if (totalLateEmployees === 0 && presentCount > 0) {
			insights.push(`Perfect punctuality: All ${presentCount} present employees arrived on time or early - exceptional team discipline!`);
		} else if (punctuality.veryLateArrivals.length > 0) {
			const criticalCount = punctuality.veryLateArrivals.length;
			const regularLateCount = punctuality.lateArrivals.length;
			if (regularLateCount > 0) {
				insights.push(`URGENT: ${criticalCount} employees arrived very late (30+ minutes) and ${regularLateCount} others were late. Total late: ${totalLateEmployees}/${presentCount} present employees.`);
			} else {
				insights.push(`URGENT: ${criticalCount} employees arrived very late (30+ minutes). This represents ${Math.round((criticalCount/presentCount)*100)}% of present employees requiring immediate attention.`);
			}
		} else if (punctuality.lateArrivals.length > 0) {
			const lateRatio = `${punctuality.lateArrivals.length}/${presentCount}`;
			insights.push(`${punctuality.lateArrivals.length} employees arrived late today (${lateRatio} present employees) with an average delay of ${punctuality.averageLateMinutes} minutes.`);
		}

		// Early arrival recognition with context
		if (punctuality.earlyArrivals.length > 0) {
			const earlyRatio = `${punctuality.earlyArrivals.length}/${presentCount}`;
			insights.push(`Outstanding dedication: ${punctuality.earlyArrivals.length} employees arrived early (${earlyRatio} present employees) - demonstrating exceptional commitment.`);
		}

		// Specific insights for severe lateness with proper context
		if (punctuality.veryLatePercentage > 20 && presentCount >= 3) {
			insights.push(`CRITICAL ALERT: ${punctuality.veryLatePercentage}% of present employees were extremely late - indicates systemic issues requiring immediate management intervention.`);
		} else if (punctuality.veryLatePercentage > 10 && presentCount >= 5) {
			insights.push(`ATTENTION: ${punctuality.veryLatePercentage}% of present employees were extremely late - monitor for emerging patterns.`);
		}

		// Contextual performance insights based on team size
		if (totalOnTimeEmployees > 0) {
			const onTimePercentage = Math.round((totalOnTimeEmployees / presentCount) * 100);
			if (presentCount >= 10) {
				if (onTimePercentage >= 90) {
					insights.push(`Excellent punctuality: ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - strong team culture.`);
				} else if (onTimePercentage >= 75) {
					insights.push(`Good punctuality: ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - opportunity for improvement.`);
				} else if (onTimePercentage >= 50) {
					insights.push(`Moderate punctuality: ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - requires attention.`);
				} else {
					insights.push(`Low punctuality: Only ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - critical issue.`);
				}
			} else if (presentCount >= 3) {
				// Small team context
				if (onTimePercentage >= 80) {
					insights.push(`Small team punctuality: ${totalOnTimeEmployees} out of ${presentCount} present employees arrived on time or early (${onTimePercentage}%) - good performance.`);
				} else {
					insights.push(`Small team punctuality: ${totalOnTimeEmployees} out of ${presentCount} present employees arrived on time or early (${onTimePercentage}%) - room for improvement.`);
				}
			} else {
				// Very small team or individual
				insights.push(`${totalOnTimeEmployees} out of ${presentCount} present ${presentCount === 1 ? 'employee' : 'employees'} arrived on time or early.`);
			}
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
			insights.push('System setup may be required to begin tracking employee performance metrics.');
			return insights;
		}

		const totalEmployees = employeeMetrics.length;
		const employeesWithCheckIn = employeeMetrics.filter((m) => m.todayCheckIn).length;
		const lateEmployees = employeeMetrics.filter((m) => m.isLate).length;
		const highPerformers = employeeMetrics.filter((m) => m.hoursWorked > Math.max(avgHours + 1, 6)).length;
		const noCheckOut = employeeMetrics.filter((m) => m.todayCheckIn && !m.todayCheckOut).length;
		const noWorkToday = employeeMetrics.filter((m) => !m.todayCheckIn && m.hoursWorked === 0).length;

		// Special handling for complete absence
		if (employeesWithCheckIn === 0) {
			insights.push(`CRITICAL: No employees checked in today out of ${totalEmployees} registered employees.`);
			insights.push('This requires immediate investigation - potential system issues, holiday schedules, or emergency situations.');
			insights.push('Immediate action: Verify employee safety and check attendance system functionality.');
			return insights;
		}

		// Enhanced completion insights with context
		if (completedShifts === 0 && employeesWithCheckIn > 0) {
			insights.push(`${employeesWithCheckIn}/${totalEmployees} employees checked in today, but none have completed their shifts yet.`);
			insights.push('All checked-in employees are still working or haven\'t checked out properly.');
		} else if (completedShifts > 0) {
			const completionRate = Math.round((completedShifts / employeesWithCheckIn) * 100);
			if (completionRate === 100) {
				insights.push(`Excellent completion: All ${completedShifts} employees who checked in today completed their shifts.`);
			} else {
				insights.push(`${completedShifts}/${employeesWithCheckIn} employees completed their shifts (${completionRate}% completion rate).`);
			}
		}

		// Enhanced hours analysis with meaningful context
		if (avgHours > 0) {
			if (completedShifts >= 3) {
				if (avgHours >= 8) {
					insights.push(`Strong productivity: Average working time of ${Math.round(avgHours * 100) / 100} hours indicates full engagement across ${completedShifts} completed shifts.`);
				} else if (avgHours >= 6) {
					insights.push(`Moderate productivity: Average working time of ${Math.round(avgHours * 100) / 100} hours shows good effort across ${completedShifts} completed shifts.`);
				} else if (avgHours >= 4) {
					insights.push(`Limited productivity: Average working time of ${Math.round(avgHours * 100) / 100} hours indicates potential challenges across ${completedShifts} completed shifts.`);
				} else {
					insights.push(`Low productivity: Average working time of only ${Math.round(avgHours * 100) / 100} hours requires investigation across ${completedShifts} completed shifts.`);
				}
			} else if (completedShifts > 0) {
				insights.push(`Limited data: ${completedShifts} completed shift${completedShifts === 1 ? '' : 's'} with average working time of ${Math.round(avgHours * 100) / 100} hours.`);
			}
		} else if (completedShifts === 0 && employeesWithCheckIn > 0) {
			insights.push('No completed shifts yet - all employees are either still working or haven\'t properly checked out.');
		}

		// Enhanced lateness analysis with proper context
		if (lateEmployees > 0) {
			const lateRate = Math.round((lateEmployees / employeesWithCheckIn) * 100);
			const totalLateMinutes = employeeMetrics.filter((m) => m.isLate).reduce((sum, m) => sum + m.lateMinutes, 0);
			const avgLateMinutes = Math.round(totalLateMinutes / lateEmployees);
			
			if (lateRate >= 50) {
				insights.push(`ATTENTION: ${lateEmployees}/${employeesWithCheckIn} employees arrived late (${lateRate}%) with average delay of ${avgLateMinutes} minutes - significant punctuality issue.`);
			} else if (lateRate >= 25) {
				insights.push(`Moderate concern: ${lateEmployees}/${employeesWithCheckIn} employees arrived late (${lateRate}%) with average delay of ${avgLateMinutes} minutes.`);
			} else {
				insights.push(`Minor lateness: ${lateEmployees}/${employeesWithCheckIn} employees arrived late (${lateRate}%) with average delay of ${avgLateMinutes} minutes.`);
			}
		} else if (employeesWithCheckIn > 0) {
			insights.push(`Excellent punctuality: All ${employeesWithCheckIn} employees who checked in arrived on time or early.`);
		}

		// High performer recognition with context
		if (highPerformers > 0) {
			const highPerformerRate = Math.round((highPerformers / Math.max(completedShifts, employeesWithCheckIn)) * 100);
			if (highPerformerRate >= 50) {
				insights.push(`Outstanding dedication: ${highPerformers} employees worked significantly above average hours (${highPerformerRate}% of active employees).`);
			} else {
				insights.push(`Strong performers: ${highPerformers} employees worked above average hours, showing exceptional commitment.`);
			}
		}

		// Still working insights with context
		if (noCheckOut > 0) {
			const stillWorkingRate = Math.round((noCheckOut / employeesWithCheckIn) * 100);
			if (stillWorkingRate >= 75) {
				insights.push(`High engagement: ${noCheckOut}/${employeesWithCheckIn} employees are still actively working (${stillWorkingRate}%).`);
			} else if (stillWorkingRate >= 25) {
				insights.push(`Continued activity: ${noCheckOut}/${employeesWithCheckIn} employees haven't checked out yet (${stillWorkingRate}%).`);
			} else {
				insights.push(`${noCheckOut} employees haven't checked out yet - may be working late or forgot to check out.`);
			}
		}

		// Absent employee insights
		if (noWorkToday > 0) {
			const absenceRate = Math.round((noWorkToday / totalEmployees) * 100);
			if (absenceRate >= 50) {
				insights.push(`High absence: ${noWorkToday}/${totalEmployees} employees had no activity today (${absenceRate}%) - requires investigation.`);
			} else if (absenceRate >= 25) {
				insights.push(`Notable absence: ${noWorkToday}/${totalEmployees} employees had no activity today (${absenceRate}%).`);
			} else if (noWorkToday === 1) {
				insights.push(`One employee had no activity today - may need follow-up.`);
			} else {
				insights.push(`${noWorkToday} employees had no activity today.`);
			}
		}

		// Zero hours worked insights (preventing "0 improvement" messages)
		const zeroHoursWorked = employeeMetrics.filter((m) => m.hoursWorked === 0).length;
		if (zeroHoursWorked > 0 && zeroHoursWorked < totalEmployees) {
			insights.push(`${zeroHoursWorked} employees recorded no working hours today - may need attention or system check.`);
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

	/**
	 * Calculate real-time hours worked including people still working
	 * This fixes the issue where people still working show 0 hours
	 */
	private calculateRealTimeHours(attendance: Attendance, currentTime: Date = new Date()): number {
		if (!attendance.checkIn) return 0;

		// If there's a duration and check out, use that (completed shift)
		if (attendance.duration && attendance.checkOut) {
			return this.parseDurationToMinutes(attendance.duration) / 60;
		}

		// If only check-in exists, calculate hours from check-in to now (still working)
		if (attendance.checkIn && !attendance.checkOut) {
			const checkInTime = new Date(attendance.checkIn);
			const diffInMs = currentTime.getTime() - checkInTime.getTime();
			const diffInHours = diffInMs / (1000 * 60 * 60);
			
			// Cap at reasonable working hours (24 hours max to handle edge cases)
			return Math.min(Math.max(0, diffInHours), 24);
		}

		return 0;
	}

	/**
	 * Get user targets for organization employees
	 * This enables target vs actual hours comparison
	 */
	private async getUserTargetsForOrganization(organizationId: number): Promise<{
		totalExpectedDailyHours: number;
		userTargetsMap: Map<number, number>;
		usersWithTargets: number;
	}> {
		try {
			let totalExpectedHours = 0;
			const userTargetsMap = new Map<number, number>();
			let usersWithTargets = 0;

			// Get all users in organization
			const usersResponse = await this.userService.findAll({ organisationId: organizationId }, 1, 1000);
			const allUsers = usersResponse.data || [];

			// Get targets for each user
			for (const user of allUsers) {
				try {
					const targetResponse = await this.userService.getUserTarget(user.uid);
					if (targetResponse?.userTarget?.targetHoursWorked) {
						const dailyTargetHours = targetResponse.userTarget.targetHoursWorked;
						userTargetsMap.set(user.uid, dailyTargetHours);
						totalExpectedHours += dailyTargetHours;
						usersWithTargets++;
					} else {
						// Default to 8 hours if no target set
						const defaultHours = 8;
						userTargetsMap.set(user.uid, defaultHours);
						totalExpectedHours += defaultHours;
					}
				} catch (error) {
					// Default to 8 hours if error getting target
					const defaultHours = 8;
					userTargetsMap.set(user.uid, defaultHours);
					totalExpectedHours += defaultHours;
					this.logger.warn(`Error getting target for user ${user.uid}:`, error);
				}
			}

			return {
				totalExpectedDailyHours: totalExpectedHours,
				userTargetsMap,
				usersWithTargets
			};
		} catch (error) {
			this.logger.error(`Error getting user targets for organization ${organizationId}:`, error);
			return {
				totalExpectedDailyHours: 0,
				userTargetsMap: new Map(),
				usersWithTargets: 0
			};
		}
	}

	/**
	 * Enhanced employee status categorization
	 */
	private categorizeEmployeesByStatus(
		allUsers: Omit<User, 'password'>[],
		todayAttendance: Attendance[],
		currentTime: Date = new Date()
	): {
		presentEmployees: AttendanceReportUser[];
		absentEmployees: AttendanceReportUser[];
		currentlyWorkingEmployees: AttendanceReportUser[];
		completedShiftEmployees: AttendanceReportUser[];
		overtimeEmployees: AttendanceReportUser[];
	} {
		const presentUserIds = new Set(todayAttendance.map(att => att.owner?.uid));
		
		const presentEmployees: AttendanceReportUser[] = [];
		const currentlyWorkingEmployees: AttendanceReportUser[] = [];
		const completedShiftEmployees: AttendanceReportUser[] = [];
		const overtimeEmployees: AttendanceReportUser[] = [];

		// Categorize present employees
		todayAttendance.forEach(attendance => {
			const owner = attendance.owner;
			if (!owner) return;

			const fullName = `${owner.name || ''} ${owner.surname || ''}`.trim();
			const hoursWorked = this.calculateRealTimeHours(attendance, currentTime);
			
			const employee: AttendanceReportUser = {
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
				checkInTime: attendance.checkIn ? format(attendance.checkIn, 'HH:mm') : undefined,
			};

			presentEmployees.push(employee);

			// Categorize by current status
			if (attendance.checkIn && !attendance.checkOut) {
				currentlyWorkingEmployees.push(employee);
			} else if (attendance.checkOut) {
				completedShiftEmployees.push(employee);
				
				// Check for overtime (more than 8 hours)
				if (hoursWorked > 8) {
					overtimeEmployees.push(employee);
				}
			}
		});

		// Create absent employees list
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
				};
			});

		return {
			presentEmployees,
			absentEmployees,
			currentlyWorkingEmployees,
			completedShiftEmployees,
			overtimeEmployees
		};
	}

	/**
	 * Calculate work day progress as a percentage (0-1)
	 * Used for projecting end-of-day performance
	 */
	private calculateWorkDayProgress(currentTime: Date, startTime: string): number {
		try {
			const currentMinutes = TimeCalculatorUtil.timeToMinutes(currentTime.toTimeString().substring(0, 5));
			const startMinutes = TimeCalculatorUtil.timeToMinutes(startTime);
			
			// Assume 8-hour work day (480 minutes) minus 1 hour lunch = 7 hours (420 minutes)
			const standardWorkDayMinutes = 420;
			const minutesIntoWorkDay = Math.max(0, currentMinutes - startMinutes);
			
			return Math.min(1, minutesIntoWorkDay / standardWorkDayMinutes);
		} catch (error) {
			this.logger.warn('Error calculating work day progress:', error);
			return 0.5; // Default to 50% if calculation fails
		}
	}

	/**
	 * Generate branch breakdown for attendance reports
	 */
	private generateBranchBreakdown(
		allUsers: Omit<User, 'password'>[],
		todayAttendance: Attendance[],
		currentTime: Date = new Date()
	): BranchSummary[] {
		const branchMap = new Map<number, BranchSummary>();
		
		// Initialize branch data
		allUsers.forEach(user => {
			if (user.branch) {
				const branchId = user.branch.uid;
				if (!branchMap.has(branchId)) {
					branchMap.set(branchId, {
						branchId,
						branchName: user.branch.name,
						presentEmployees: [],
						absentEmployees: [],
						currentlyWorkingEmployees: [],
						completedShiftEmployees: [],
						attendanceRate: 0,
						totalEmployees: 0,
						totalHoursWorked: 0,
						averageHoursWorked: 0,
					});
				}
			}
		});

		// Categorize employees by branch
		const presentUserIds = new Set(todayAttendance.map(att => att.owner?.uid));
		
		// Process all users and categorize them by branch
		allUsers.forEach(user => {
			if (!user.branch) return;
			
			const branch = branchMap.get(user.branch.uid);
			if (!branch) return;

			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
			const employeeData: AttendanceReportUser = {
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
				branch: {
					uid: user.branch.uid,
					name: user.branch.name || 'Unknown Branch',
				},
			};

			branch.totalEmployees++;

			const attendance = todayAttendance.find(att => att.owner?.uid === user.uid);
			
			if (attendance) {
				// Present employee
				employeeData.checkInTime = attendance.checkIn ? format(attendance.checkIn, 'HH:mm') : undefined;
				branch.presentEmployees.push(employeeData);
				
				// Calculate hours worked
				const hoursWorked = this.calculateRealTimeHours(attendance, currentTime);
				branch.totalHoursWorked += hoursWorked;

				// Categorize by status
				if (attendance.checkIn && !attendance.checkOut) {
					branch.currentlyWorkingEmployees.push(employeeData);
				} else if (attendance.checkOut) {
					branch.completedShiftEmployees.push(employeeData);
				}
			} else {
				// Absent employee
				branch.absentEmployees.push(employeeData);
			}
		});

		// Calculate final metrics for each branch
		const branchSummaries: BranchSummary[] = Array.from(branchMap.values()).map(branch => {
			const attendanceRate = branch.totalEmployees > 0 
				? Math.round((branch.presentEmployees.length / branch.totalEmployees) * 100) 
				: 0;
			
			const averageHoursWorked = branch.presentEmployees.length > 0 
				? Math.round((branch.totalHoursWorked / branch.presentEmployees.length) * 100) / 100 
				: 0;

			return {
				...branch,
				attendanceRate,
				totalHoursWorked: Math.round(branch.totalHoursWorked * 100) / 100,
				averageHoursWorked,
			};
		});

		return branchSummaries.sort((a, b) => a.branchName.localeCompare(b.branchName));
	}

	/**
	 * Enhanced morning insights including target performance analysis
	 */
	private generateEnhancedMorningInsights(
		attendanceRate: number,
		punctuality: PunctualityBreakdown,
		presentCount: number,
		totalEmployees: number,
		targetPerformance: any,
		employeeCategories: any
	): string[] {
		const insights: string[] = [];

		// Call existing insights first
		const baseInsights = this.generateMorningInsights(attendanceRate, punctuality, presentCount, totalEmployees);
		insights.push(...baseInsights);

		// Add target-based insights
		if (targetPerformance.expectedDailyHours > 0) {
			insights.push(
				`Target Analysis: ${targetPerformance.actualHoursToDate}h worked of ${targetPerformance.expectedDailyHours}h expected daily target (${targetPerformance.targetAchievementRate}% achieved)`
			);

			if (targetPerformance.onTrackToMeetTargets) {
				insights.push(
					`✅ Performance Outlook: Team is projected to achieve ${targetPerformance.projectedEndOfDayHours}h by day end - ON TRACK to meet targets!`
				);
			} else {
				insights.push(
					`⚠️ Performance Alert: Projected ${targetPerformance.projectedEndOfDayHours}h by day end - ${targetPerformance.hoursGapAnalysis}`
				);
			}
		}

		// Add status-based insights
		if (employeeCategories.currentlyWorkingEmployees.length > 0) {
			insights.push(
				`Currently Active: ${employeeCategories.currentlyWorkingEmployees.length} employees are actively working and accumulating hours`
			);
		}

		if (employeeCategories.completedShiftEmployees.length > 0) {
			insights.push(
				`Completed Shifts: ${employeeCategories.completedShiftEmployees.length} employees have already completed their work for today`
			);
		}

		return insights;
	}

	/**
	 * Enhanced morning recommendations including target-based actions
	 */
	private generateEnhancedMorningRecommendations(
		punctuality: PunctualityBreakdown,
		attendanceRate: number,
		targetPerformance: any,
		employeeCategories: any
	): string[] {
		const recommendations: string[] = [];

		// Call existing recommendations first
		const baseRecommendations = this.generateMorningRecommendations(punctuality, attendanceRate);
		recommendations.push(...baseRecommendations);

		// Add target-based recommendations
		if (!targetPerformance.onTrackToMeetTargets && targetPerformance.expectedDailyHours > 0) {
			recommendations.push(
				`🎯 Target Recovery: Team needs ${targetPerformance.hoursGapAnalysis} - consider productivity support or schedule adjustments`
			);
			
			if (employeeCategories.absentEmployees.length > 0) {
				recommendations.push(
					`📞 Urgent Contact: Follow up with ${employeeCategories.absentEmployees.length} absent employees to recover lost productivity hours`
				);
			}
		}

		if (targetPerformance.onTrackToMeetTargets && targetPerformance.targetAchievementRate > 100) {
			recommendations.push(
				`🏆 Excellence Opportunity: Team is exceeding targets - consider recognizing high performers and documenting best practices`
			);
		}

		// Status-specific recommendations
		if (employeeCategories.currentlyWorkingEmployees.length > 0) {
			recommendations.push(
				`⏰ Monitor Progress: Check in with ${employeeCategories.currentlyWorkingEmployees.length} active employees around midday to ensure they stay on track`
			);
		}

		return recommendations;
	}

	/**
	 * Enhanced evening insights including target performance analysis
	 */
	private generateEnhancedEveningInsights(
		employeeMetrics: EmployeeAttendanceMetric[],
		completedShifts: number,
		avgHours: number,
		targetPerformance: any,
		employeeCategories: any
	): string[] {
		const insights: string[] = [];

		// Call existing insights first
		const baseInsights = this.generateEveningInsights(employeeMetrics, completedShifts, avgHours);
		insights.push(...baseInsights);

		// Add comprehensive target analysis
		if (targetPerformance.expectedDailyHours > 0) {
			insights.push(
				`🎯 Target Performance: ${targetPerformance.actualTotalHours}h worked of ${targetPerformance.expectedDailyHours}h target (${targetPerformance.targetAchievementRate}% achieved) - ${targetPerformance.teamEfficiencyRating} efficiency`
			);

			if (targetPerformance.individualTargetsMet > 0) {
				insights.push(
					`✅ Individual Success: ${targetPerformance.individualTargetsMet} employees met their personal targets`
				);
			}

			if (targetPerformance.individualTargetsMissed > 0) {
				insights.push(
					`📊 Growth Opportunity: ${targetPerformance.individualTargetsMissed} employees need support to reach their targets`
				);
			}

			if (targetPerformance.hoursOverTarget > 0) {
				insights.push(
					`🚀 Exceeded Expectations: Team worked ${targetPerformance.hoursOverTarget}h above target - outstanding commitment!`
				);
			} else if (targetPerformance.hoursUnderTarget > 0) {
				insights.push(
					`⚡ Recovery Needed: Team is ${targetPerformance.hoursUnderTarget}h behind target - focus on productivity improvements`
				);
			}
		}

		// Add enhanced status insights
		if (employeeCategories.currentlyWorkingEmployees.length > 0) {
			insights.push(
				`⏰ Still Active: ${employeeCategories.currentlyWorkingEmployees.length} employees are still working and contributing to daily targets`
			);
		}

		if (employeeCategories.overtimeEmployees.length > 0) {
			insights.push(
				`💪 Overtime Champions: ${employeeCategories.overtimeEmployees.length} employees worked overtime, showing exceptional dedication`
			);
		}

		return insights;
	}
}
