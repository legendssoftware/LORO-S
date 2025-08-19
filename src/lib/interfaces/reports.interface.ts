import { AccessLevel } from '../enums/user.enums';

export interface AttendanceReportUser {
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

export interface AttendanceSummary {
	totalEmployees: number;
	presentCount: number;
	absentCount: number;
	attendanceRate: number;
	totalActualHours: number;
	totalExpectedHours: number;
	productivityRate: number;
	hoursDeficit: number;
}

export interface BranchPunctuality {
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

export interface PunctualityBreakdown {
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

export interface EmployeeAttendanceMetric {
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

export interface BranchSummary {
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

export interface MorningReportData {
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

export interface TemplateEmployeeMetric {
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

export interface EveningReportData {
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
