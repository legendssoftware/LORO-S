import { ApiProperty } from '@nestjs/swagger';

export class UserAnalyticsDto {
	@ApiProperty({ description: 'Total number of attendance records', example: 45 })
	totalRecords: number;

	@ApiProperty({ description: 'Attendance rate percentage', example: 95.5 })
	attendanceRate: number;

	@ApiProperty({ description: 'Average hours worked per day', example: 8.2 })
	averageHoursPerDay: number;

	@ApiProperty({ description: 'Punctuality score percentage', example: 87.5 })
	punctualityScore: number;

	@ApiProperty({ description: 'Overtime frequency percentage', example: 15.5 })
	overtimeFrequency: number;

	@ApiProperty({ description: 'Average check-in time', example: '08:47:00' })
	averageCheckInTime: string;

	@ApiProperty({ description: 'Average check-out time', example: '17:23:00' })
	averageCheckOutTime: string;

	@ApiProperty({ description: 'Total work hours', example: 368.5 })
	totalWorkHours: number;

	@ApiProperty({ description: 'Total break time in hours', example: 42.5 })
	totalBreakTime: number;

	@ApiProperty({ description: 'Longest shift duration', example: '11h 30m' })
	longestShift: string;

	@ApiProperty({ description: 'Shortest shift duration', example: '6h 15m' })
	shortestShift: string;

	@ApiProperty({ description: 'Current attendance streak in days', example: 12 })
	attendanceStreak: number;

	@ApiProperty({ description: 'Last attendance date', example: '2024-03-01T17:30:00Z' })
	lastAttendance: string;
}

export class PerformanceInsightsDto {
	@ApiProperty({
		description: 'Identified strengths in attendance patterns',
		example: ['Excellent punctuality', 'Consistent attendance', 'Good work-life balance'],
	})
	strengths: string[];

	@ApiProperty({
		description: 'Suggested improvements',
		example: ['Consider reducing overtime hours', 'Optimize break timing'],
	})
	improvements: string[];

	@ApiProperty({
		description: 'Trend analysis',
		example: {
			trend: 'IMPROVING',
			confidence: 85.5,
			details: 'Punctuality has improved by 12% over the last 3 months',
		},
	})
	trendAnalysis: {
		trend: string;
		confidence: number;
		details: string;
	};
}

export class UserMetricsResponseDto {
	@ApiProperty({ description: 'Success or error message', example: 'Success' })
	message: string;

	@ApiProperty({ type: UserAnalyticsDto })
	userAnalytics: UserAnalyticsDto;

	@ApiProperty({ type: PerformanceInsightsDto })
	performanceInsights: PerformanceInsightsDto;
}
