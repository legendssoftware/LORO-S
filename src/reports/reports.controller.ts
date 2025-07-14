import { Controller, Post, Body, Param, Get, UseGuards, Req, BadRequestException, Logger } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportParamsDto } from './dto/report-params.dto';
import { ReportType } from './constants/report-types.enum';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiBadRequestResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';

@ApiBearerAuth('JWT-auth')
@ApiTags('📊 Reports')
@Controller('reports')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class ReportsController {
	private readonly logger = new Logger(ReportsController.name);

	constructor(private readonly reportsService: ReportsService) {}

	// Unified endpoint for all report types
	@Post(':type/generate')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Generate a comprehensive report',
		description:
			'Generates a detailed report based on the specified type and parameters. Available types: main, user, shift, quotation',
	})
	@ApiParam({
		name: 'type',
		description: 'Report type (main, user, shift, quotation)',
		enum: ['main', 'user', 'shift', 'quotation'],
		example: 'main',
	})
	@ApiBody({
		description: 'Report generation parameters',
		schema: {
			type: 'object',
			properties: {
				organisationId: {
					type: 'number',
					description: 'Organization ID (optional if available from auth context)',
				},
				branchId: {
					type: 'number',
					description: 'Branch ID (optional)',
				},
				name: {
					type: 'string',
					description: 'Report name (optional)',
				},
				startDate: {
					type: 'string',
					description: 'Start date for report data (YYYY-MM-DD)',
					example: '2023-01-01',
				},
				endDate: {
					type: 'string',
					description: 'End date for report data (YYYY-MM-DD)',
					example: '2023-12-31',
				},
				filters: {
					type: 'object',
					description: 'Additional filters for the report',
					example: {
						status: 'active',
						category: 'sales',
						clientId: 123,
					},
				},
			},
		},
	})
	@ApiOkResponse({
		description: 'Report generated successfully',
		schema: {
			type: 'object',
			properties: {
				metadata: {
					type: 'object',
					properties: {
						organisationId: { type: 'number' },
						branchId: { type: 'number' },
						generatedAt: { type: 'string', format: 'date-time' },
						type: { type: 'string', enum: ['main', 'user', 'shift', 'quotation'] },
						name: { type: 'string' },
					},
				},
				summary: {
					type: 'object',
					description: 'Summary statistics from the report',
				},
				metrics: {
					type: 'object',
					description: 'Various metrics calculated from the report data',
				},
				data: {
					type: 'object',
					description: 'Raw entity data from the database',
				},
				fromCache: {
					type: 'boolean',
					description: 'Indicates if the report was served from cache',
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid report type or missing required parameters' },
			},
		},
	})
	async generateReport(
		@Param('type') type: string,
		@Body()
		reportParams: {
			organisationId?: number;
			branchId?: number;
			name?: string;
			startDate?: string;
			endDate?: string;
			filters?: Record<string, any>;
		},
		@Req() request: AuthenticatedRequest,
	) {
		// Validate report type
		if (!Object.values(ReportType).includes(type as ReportType)) {
			throw new BadRequestException(
				`Invalid report type: ${type}. Valid types are: ${Object.values(ReportType).join(', ')}`,
			);
		}

		// Use organization ID from authenticated request if not provided
		const orgId = reportParams.organisationId || request.user.org?.uid || request.user.organisationRef;

		if (!orgId) {
			throw new BadRequestException(
				'Organisation ID is required. Either specify it in the request body or it must be available in the authentication context.',
			);
		}

		// Use branch ID from authenticated request if not provided
		const brId = reportParams.branchId || request.user.branch?.uid;

		// Build params object
		const params: ReportParamsDto = {
			type: type as ReportType,
			organisationId: orgId,
			branchId: brId,
			name: reportParams.name,
			dateRange:
				reportParams.startDate && reportParams.endDate
					? {
							start: new Date(reportParams.startDate),
							end: new Date(reportParams.endDate),
					  }
					: undefined,
			filters: reportParams.filters,
		};

		// Generate the report
		return this.reportsService.generateReport(params, request.user);
	}

	// Specific endpoint for client quotation reports
	@Get('client/:clientId')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.CLIENT)
	@ApiOperation({
		summary: 'Generate a client quotation report',
		description: 'Generates a detailed report of quotations for a specific client',
	})
	@ApiParam({
		name: 'clientId',
		description: 'Client ID',
		example: 123,
	})
	@ApiBody({
		description: 'Report generation parameters',
		schema: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Report name (optional)',
				},
				startDate: {
					type: 'string',
					description: 'Start date for report data (YYYY-MM-DD)',
					example: '2023-01-01',
				},
				endDate: {
					type: 'string',
					description: 'End date for report data (YYYY-MM-DD)',
					example: '2023-12-31',
				},
				additionalFilters: {
					type: 'object',
					description: 'Additional filters for the report',
					example: {
						status: 'approved',
					},
				},
			},
		},
	})
	@ApiOkResponse({
		description: 'Client quotation report generated successfully',
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
	})
	async generateClientQuotationReport(
		@Param('clientId') clientId: number,
		@Body()
		reportParams: {
			name?: string;
			startDate?: string;
			endDate?: string;
			additionalFilters?: Record<string, any>;
		},
		@Req() request: AuthenticatedRequest,
	) {
		// Use organization ID from authenticated request
		const orgId = request.user.org?.uid || request.user.organisationRef;

		if (!orgId) {
			throw new BadRequestException('Organisation ID must be available in the authentication context.');
		}

		// Get branch ID from authenticated request if available
		const brId = request.user.branch?.uid;

		// For client users, extract client data from JWT token
		// Looking at the client-auth.service.ts, we need to extract client info
		const authHeader = request.headers.authorization;

		let requestingClientId = Number(clientId);

		if (authHeader) {
			const token = authHeader.split(' ')[1];
			try {
				const decodedToken = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

				// For CLIENT role, we need to ensure they're accessing their own data
				if (decodedToken.role === AccessLevel.CLIENT) {
					// The token might contain client info in different ways
					// Check all possibilities
					if (decodedToken.clientId) {
						requestingClientId = Number(decodedToken.clientId);
					} else if (decodedToken.client && decodedToken.client.uid) {
						requestingClientId = Number(decodedToken.client.uid);
					} else {
						// If we can't find client ID in token, use the UID as fallback
						// This assumes UID might be related to client
					}
				} else {
					// For non-client users, use the clientId from the URL
				}
			} catch (error) {}
		}

		// Build params object for the quotation report
		const params: ReportParamsDto = {
			type: ReportType.QUOTATION,
			organisationId: orgId,
			branchId: brId,
			name: reportParams.name || 'Client Quotation Report',
			dateRange:
				reportParams.startDate && reportParams.endDate
					? {
							start: new Date(reportParams.startDate),
							end: new Date(reportParams.endDate),
					  }
					: undefined,
			filters: {
				clientId: requestingClientId,
				...reportParams.additionalFilters,
			},
		};

		// Generate the report
		return this.reportsService.generateReport(params, request.user);
	}

	// HR Analytics Endpoints
	@Get('hr/attendance')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.HR, AccessLevel.OWNER)
	@ApiOperation({
		summary: '👥 Get comprehensive attendance analytics',
		description: `
# Attendance Analytics Dashboard

Comprehensive attendance tracking and analysis with real-time metrics, trend analysis, and performance insights.

## 📊 **Attendance Metrics**
- **Daily Attendance**: Current day attendance rate with real-time updates
- **Weekly Patterns**: Weekly attendance trends and patterns
- **Monthly Overview**: Monthly attendance statistics and comparisons
- **Punctuality Analysis**: On-time arrival rates and lateness patterns
- **Overtime Tracking**: Overtime hours and patterns analysis
- **Absence Tracking**: Absence frequency and patterns

## 🎯 **Performance Indicators**
- **Attendance Rate**: Overall attendance percentage
- **Punctuality Score**: On-time arrival percentage
- **Average Hours**: Average working hours per employee
- **Overtime Hours**: Total and average overtime hours
- **Late Arrivals**: Number and percentage of late arrivals
- **Early Departures**: Early departure tracking and analysis

## 📈 **Trend Analysis**
- **Attendance Trends**: Daily, weekly, monthly attendance trends
- **Seasonal Patterns**: Seasonal attendance variations
- **Department Comparison**: Inter-department attendance comparison
- **Branch Analysis**: Multi-branch attendance analysis
- **Employee Patterns**: Individual employee attendance patterns
- **Productivity Correlation**: Attendance vs productivity correlation

## 🏢 **Organizational Insights**
- **Department Breakdown**: Attendance by department
- **Branch Performance**: Branch-wise attendance metrics
- **Team Analysis**: Team attendance performance
- **Shift Patterns**: Shift-wise attendance analysis
		`,
	})
	@ApiOkResponse({
		description: 'Attendance analytics data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalEmployees: { type: 'number' },
						presentToday: { type: 'number' },
						attendanceRate: { type: 'number' },
						averageHoursWorked: { type: 'number' },
						lateArrivals: { type: 'number' },
						earlyDepartures: { type: 'number' },
					},
				},
				trends: {
					type: 'object',
					properties: {
						dailyAttendance: { type: 'array' },
						monthlyAttendance: { type: 'array' },
						punctualityTrends: { type: 'array' },
					},
				},
				chartData: {
					type: 'object',
					properties: {
						attendanceOverTime: { type: 'array' },
						punctualityDistribution: { type: 'array' },
						departmentBreakdown: { type: 'array' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
	})
	async getAttendanceAnalytics(@Req() request: AuthenticatedRequest) {
		this.logger.log('Getting attendance analytics');
		
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateAttendanceAnalytics(orgId, branchId);
	}

	@Get('hr/employee-performance')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.HR, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🏆 Get employee performance analytics',
		description: `
# Employee Performance Analytics Dashboard

Comprehensive employee performance tracking with KPIs, goal achievement, and development insights.

## 📊 **Performance Metrics**
- **Overall Performance**: Company-wide performance scores
- **Individual Metrics**: Employee-specific performance data
- **Goal Achievement**: Target vs actual performance tracking
- **Skill Assessments**: Skills evaluation and development needs
- **Productivity Scores**: Work output and efficiency metrics
- **Quality Metrics**: Work quality and error rate analysis

## 🎯 **Key Performance Indicators**
- **Performance Score**: Overall performance rating
- **Goal Completion Rate**: Percentage of goals achieved
- **Skill Development**: Skills improvement over time
- **Productivity Index**: Work output efficiency
- **Quality Score**: Work quality assessment
- **Team Collaboration**: Team collaboration effectiveness

## 📈 **Performance Trends**
- **Monthly Performance**: Month-over-month performance trends
- **Quarterly Reviews**: Quarterly performance summaries
- **Annual Assessments**: Yearly performance evaluations
- **Skill Progression**: Skills development over time
- **Career Growth**: Career progression tracking
- **Training Effectiveness**: Training impact on performance

## 🏢 **Organizational Analysis**
- **Department Performance**: Performance by department
- **Team Effectiveness**: Team performance metrics
- **Manager Effectiveness**: Management performance impact
- **Training ROI**: Training return on investment
		`,
	})
	@ApiOkResponse({
		description: 'Employee performance analytics data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalEmployees: { type: 'number' },
						averagePerformanceScore: { type: 'number' },
						topPerformers: { type: 'array' },
						improvementNeeded: { type: 'array' },
						targetAchievementRate: { type: 'number' },
					},
				},
				metrics: {
					type: 'object',
					properties: {
						productivityScores: { type: 'array' },
						goalAchievements: { type: 'array' },
						skillAssessments: { type: 'array' },
					},
				},
				chartData: {
					type: 'object',
					properties: {
						performanceDistribution: { type: 'array' },
						skillsMatrix: { type: 'array' },
						performanceTrends: { type: 'array' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
	})
	async getEmployeePerformanceAnalytics(@Req() request: AuthenticatedRequest) {
		this.logger.log('Getting employee performance analytics');
		
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateEmployeePerformanceAnalytics(orgId, branchId);
	}

	@Get('hr/payroll')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.HR, AccessLevel.OWNER)
	@ApiOperation({
		summary: '💰 Get payroll analytics',
		description: `
# Payroll Analytics Dashboard

Comprehensive payroll analysis with cost tracking, benefits utilization, and compensation insights.

## 💵 **Payroll Metrics**
- **Total Payroll Cost**: Overall payroll expenses
- **Average Salary**: Mean salary across organization
- **Benefits Cost**: Total benefits and utilization
- **Overtime Costs**: Overtime expenses and trends
- **Cost per Employee**: Average cost per employee
- **Payroll Growth**: Payroll cost growth analysis

## 📊 **Cost Analysis**
- **Salary Distribution**: Salary ranges and distribution
- **Benefits Breakdown**: Benefits cost by type
- **Department Costs**: Payroll costs by department
- **Position Analysis**: Compensation by position/role
- **Geographic Variations**: Location-based compensation
- **Cost Efficiency**: Cost per productivity unit

## 📈 **Trends and Forecasting**
- **Monthly Payroll**: Monthly payroll trends
- **Quarterly Analysis**: Quarterly payroll summaries
- **Annual Projections**: Yearly payroll forecasts
- **Budget Variance**: Budget vs actual analysis
- **Cost Optimization**: Cost optimization opportunities
- **Market Benchmarking**: Salary market comparison

## 🏢 **Organizational Insights**
- **Department Breakdown**: Payroll by department
- **Role Analysis**: Compensation by role
- **Experience Levels**: Pay by experience level
- **Performance Correlation**: Pay vs performance analysis
		`,
	})
	@ApiOkResponse({
		description: 'Payroll analytics data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalPayrollCost: { type: 'number' },
						averageSalary: { type: 'number' },
						totalBenefitsCost: { type: 'number' },
						payrollGrowth: { type: 'number' },
						costPerEmployee: { type: 'number' },
					},
				},
				breakdown: {
					type: 'object',
					properties: {
						salaryDistribution: { type: 'array' },
						benefitsUtilization: { type: 'array' },
						departmentCosts: { type: 'array' },
					},
				},
				chartData: {
					type: 'object',
					properties: {
						payrollTrends: { type: 'array' },
						salaryBands: { type: 'array' },
						benefitsCosts: { type: 'array' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
	})
	async getPayrollAnalytics(@Req() request: AuthenticatedRequest) {
		this.logger.log('Getting payroll analytics');
		
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generatePayrollAnalytics(orgId, branchId);
	}

	@Get('hr/recruitment')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.HR, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🎯 Get recruitment analytics',
		description: `
# Recruitment Analytics Dashboard

Comprehensive recruitment tracking with pipeline analysis, sourcing effectiveness, and hiring metrics.

## 📊 **Recruitment Metrics**
- **Total Applications**: Number of applications received
- **Active Positions**: Currently open positions
- **Time to Hire**: Average time from application to hire
- **Offer Acceptance Rate**: Percentage of offers accepted
- **Sourcing Effectiveness**: Best performing sourcing channels
- **Recruitment Cost**: Cost per hire and total costs

## 🎯 **Pipeline Analysis**
- **Candidate Pipeline**: Candidates by stage
- **Interview Scheduled**: Upcoming interviews
- **Offers Sent**: Pending offers and responses
- **Positions to Fill**: Open positions and urgency
- **Conversion Rates**: Stage-to-stage conversion rates
- **Drop-off Analysis**: Where candidates drop off

## 📈 **Hiring Trends**
- **Monthly Hiring**: Monthly hiring volume
- **Seasonal Patterns**: Seasonal hiring trends
- **Department Needs**: Hiring needs by department
- **Role Difficulty**: Hard-to-fill positions
- **Market Conditions**: Hiring market analysis
- **Forecast Planning**: Future hiring needs

## 🏢 **Organizational Insights**
- **Department Hiring**: Hiring by department
- **Role Analysis**: Hiring by role type
- **Experience Levels**: Hiring by experience
- **Diversity Metrics**: Diversity in hiring
		`,
	})
	@ApiOkResponse({
		description: 'Recruitment analytics data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalApplications: { type: 'number' },
						activePositions: { type: 'number' },
						averageTimeToHire: { type: 'number' },
						offerAcceptanceRate: { type: 'number' },
						recruitmentCost: { type: 'number' },
					},
				},
				pipeline: {
					type: 'object',
					properties: {
						candidatesByStage: { type: 'array' },
						interviewScheduled: { type: 'number' },
						offersSent: { type: 'number' },
						positionsToFill: { type: 'number' },
					},
				},
				chartData: {
					type: 'object',
					properties: {
						hiringTrends: { type: 'array' },
						sourcingChannels: { type: 'array' },
						candidatePipeline: { type: 'array' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
	})
	async getRecruitmentAnalytics(@Req() request: AuthenticatedRequest) {
		this.logger.log('Getting recruitment analytics');
		
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateRecruitmentAnalytics(orgId, branchId);
	}

	// Get Map Data endpoint
	@Get('map-data')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🗺️ Get map data for visualization',
		description: `
# Map Data Dashboard

Real-time map visualization data including employee locations, client locations, and business metrics.

## 🗺️ **Map Visualization Data**
- **Employee Locations**: Real-time employee locations
- **Client Locations**: Active client locations
- **Competitor Locations**: Competitor mapping
- **Quotation Locations**: Quotation and order locations
- **Territory Mapping**: Sales territory visualization
- **Performance Mapping**: Performance metrics by location

## 📊 **Location Analytics**
- **Geographic Distribution**: Entity distribution by location
- **Density Analysis**: Concentration of activities
- **Route Optimization**: Optimal route planning
- **Territory Performance**: Performance by territory
- **Market Coverage**: Market coverage analysis
- **Travel Patterns**: Employee travel patterns
		`,
	})
	@ApiOkResponse({
		description: 'Map data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						workers: { type: 'array' },
						clients: { type: 'array' },
						competitors: { type: 'array' },
						quotations: { type: 'array' },
					},
				},
				summary: {
					type: 'object',
					properties: {
						totalWorkers: { type: 'number' },
						totalClients: { type: 'number' },
						totalCompetitors: { type: 'number' },
						totalQuotations: { type: 'number' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
	})
	async getMapData(@Req() request: AuthenticatedRequest) {
		this.logger.log('Getting map data');
		
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateMapData({ organisationId: orgId, branchId });
	}

	@Post('daily-report/:userId')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Generate a daily report for a specific user',
		description: 'Generates and sends a daily activity report for a specific user',
	})
	@ApiParam({
		name: 'userId',
		description: 'ID of the user to generate report for',
		type: 'number',
	})
	@ApiOkResponse({
		description: 'Report generated and sent successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean' },
				message: { type: 'string' },
				reportId: { type: 'number' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid user ID',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
			},
		},
	})
	async generateDailyReportForUser(@Param('userId') userId: number, @Req() request: AuthenticatedRequest) {
		try {
			// Validate userId
			if (!userId || isNaN(Number(userId))) {
				throw new BadRequestException('Valid user ID is required');
			}

			// Create report parameters with the organization from the request context
			const params: ReportParamsDto = {
				type: ReportType.USER_DAILY,
				organisationId: request.user.organisationRef || request.user.org?.uid,
				filters: {
					userId: Number(userId),
				},
			};

			// Generate and send report
			const report = await this.reportsService.generateUserDailyReport(params);

			return {
				success: true,
				message: `Daily report generated and sent successfully`,
				reportId: report.uid,
			};
		} catch (error) {
			this.logger.error(`Error generating manual daily report: ${error.message}`, error.stack);
			throw error;
		}
	}

	// Sales Analytics Endpoints
	@Get('sales/overview')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📊 Get comprehensive sales overview',
		description: `
# Sales Overview Dashboard

Provides comprehensive sales performance metrics including revenue trends, quotation analytics, and conversion rates.

## 📈 **Key Metrics**
- **Total Revenue**: Current period revenue with comparison to previous period
- **Quotation Volume**: Number of quotations generated and their status breakdown
- **Conversion Rate**: Quotation to order conversion percentage
- **Average Order Value**: Mean transaction value with trend analysis
- **Top Products**: Best-performing products by revenue and volume
- **Performance by Period**: Daily, weekly, and monthly performance comparisons

## 🎯 **Analytics Features**
- **Revenue Trends**: Time-series analysis of revenue growth
- **Quotation Analytics**: Breakdown of quotation statuses and conversion paths
- **Customer Insights**: Top customers by revenue and transaction frequency
- **Product Performance**: Best and worst-performing products
- **Sales Team Performance**: Individual and team performance metrics
- **Market Analysis**: Territory and regional performance comparison

## 📊 **Chart Data**
- **Line Charts**: Revenue trends over time
- **Bar Charts**: Quotation volume by status
- **Pie Charts**: Revenue distribution by product category
- **Area Charts**: Cumulative revenue growth
- **Scatter Plots**: Quotation value vs conversion rate correlation
		`,
	})
	@ApiOkResponse({
		description: '✅ Sales overview retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalRevenue: { type: 'number', example: 125000.50 },
						revenueGrowth: { type: 'number', example: 12.5 },
						totalQuotations: { type: 'number', example: 45 },
						conversionRate: { type: 'number', example: 68.9 },
						averageOrderValue: { type: 'number', example: 2777.78 },
						topPerformingProduct: { type: 'string', example: 'Premium Widget' },
					},
				},
				trends: {
					type: 'object',
					properties: {
						revenue: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									date: { type: 'string', format: 'date' },
									amount: { type: 'number' },
									quotations: { type: 'number' },
								},
							},
						},
						quotationsByStatus: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									status: { type: 'string', example: 'pending' },
									count: { type: 'number', example: 15 },
									value: { type: 'number', example: 41666.67 },
								},
							},
						},
						topProducts: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									name: { type: 'string', example: 'Premium Widget' },
									revenue: { type: 'number', example: 25000.00 },
									units: { type: 'number', example: 50 },
								},
							},
						},
					},
				},
				chartData: {
					type: 'object',
					properties: {
						revenueTimeSeries: { type: 'array', description: 'Data for line charts' },
						quotationDistribution: { type: 'array', description: 'Data for pie charts' },
						performanceComparison: { type: 'array', description: 'Data for bar charts' },
						cumulativeGrowth: { type: 'array', description: 'Data for area charts' },
						correlationData: { type: 'array', description: 'Data for scatter plots' },
					},
				},
			},
		},
	})
	async getSalesOverview(@Req() request: AuthenticatedRequest) {
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateSalesOverview(orgId, branchId);
	}

	@Get('sales/quotations')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📋 Get quotation analytics',
		description: `
# Quotation Analytics Dashboard

Detailed analysis of quotation performance including blank quotations, conversion rates, and pricing strategy effectiveness.

## 📊 **Quotation Metrics**
- **Total Quotations**: Including regular and blank quotations
- **Status Distribution**: Breakdown by draft, pending, approved, rejected
- **Conversion Funnel**: Step-by-step conversion analysis
- **Pricing Strategy**: Performance by price list type
- **Time-to-Convert**: Average time from quotation to order
- **Revenue Pipeline**: Potential revenue from pending quotations

## 🎯 **Blank Quotation Analysis**
- **Blank vs Regular**: Comparison of blank quotation performance
- **Price List Performance**: Analysis by premium, standard, local, foreign pricing
- **Conversion Rates**: Blank quotation to order conversion rates
- **Customer Response**: Response time and engagement metrics
- **Revenue Impact**: Revenue generated from blank quotations

## 📈 **Trend Analysis**
- **Quotation Volume**: Daily, weekly, monthly quotation trends
- **Success Rate**: Conversion rate trends over time
- **Value Trends**: Average quotation value trends
- **Seasonal Patterns**: Identification of seasonal quotation patterns
		`,
	})
	@ApiOkResponse({
		description: '✅ Quotation analytics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalQuotations: { type: 'number', example: 150 },
						blankQuotations: { type: 'number', example: 45 },
						conversionRate: { type: 'number', example: 68.9 },
						averageValue: { type: 'number', example: 2777.78 },
						averageTimeToConvert: { type: 'number', example: 3.2 },
						pipelineValue: { type: 'number', example: 87500.00 },
					},
				},
				statusBreakdown: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							status: { type: 'string', example: 'pending' },
							count: { type: 'number', example: 25 },
							value: { type: 'number', example: 69444.45 },
							percentage: { type: 'number', example: 16.7 },
						},
					},
				},
				priceListPerformance: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							priceList: { type: 'string', example: 'premium' },
							quotations: { type: 'number', example: 15 },
							conversions: { type: 'number', example: 12 },
							conversionRate: { type: 'number', example: 80.0 },
							revenue: { type: 'number', example: 33333.33 },
						},
					},
				},
			},
		},
	})
	async getQuotationAnalytics(@Req() request: AuthenticatedRequest) {
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateQuotationAnalytics(orgId, branchId);
	}

	@Get('sales/revenue')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '💰 Get detailed revenue analytics',
		description: `
# Revenue Analytics Dashboard

Comprehensive revenue analysis with trend forecasting, growth metrics, and profitability insights.

## 💵 **Revenue Metrics**
- **Current Period Revenue**: Total revenue for selected period
- **Revenue Growth**: Period-over-period growth percentage
- **Revenue per Customer**: Average revenue per customer
- **Revenue by Product**: Product-wise revenue breakdown
- **Revenue by Territory**: Geographic revenue distribution
- **Profitability Analysis**: Gross margin and profit trends

## 📈 **Trend Analysis**
- **Daily Revenue**: Day-by-day revenue tracking
- **Weekly Patterns**: Weekly revenue patterns and seasonality
- **Monthly Trends**: Month-over-month revenue growth
- **Quarterly Performance**: Quarterly revenue analysis
- **Year-over-Year**: Annual revenue comparison

## 🎯 **Revenue Forecasting**
- **Predictive Analytics**: Revenue forecasting based on historical trends
- **Pipeline Analysis**: Revenue pipeline from pending quotations
- **Seasonal Adjustments**: Seasonal revenue predictions
- **Growth Projections**: Expected revenue growth scenarios
		`,
	})
	@ApiOkResponse({
		description: '✅ Revenue analytics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalRevenue: { type: 'number', example: 125000.50 },
						revenueGrowth: { type: 'number', example: 12.5 },
						revenuePerCustomer: { type: 'number', example: 4166.68 },
						grossMargin: { type: 'number', example: 35.2 },
						profitMargin: { type: 'number', example: 18.7 },
					},
				},
				timeSeries: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							date: { type: 'string', format: 'date' },
							revenue: { type: 'number' },
							transactions: { type: 'number' },
							averageValue: { type: 'number' },
						},
					},
				},
				productBreakdown: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							product: { type: 'string', example: 'Premium Widget' },
							revenue: { type: 'number', example: 25000.00 },
							percentage: { type: 'number', example: 20.0 },
							growth: { type: 'number', example: 15.3 },
						},
					},
				},
				forecast: {
					type: 'object',
					properties: {
						nextMonth: { type: 'number', example: 135000.00 },
						nextQuarter: { type: 'number', example: 405000.00 },
						confidence: { type: 'number', example: 85.2 },
					},
				},
			},
		},
	})
	async getRevenueAnalytics(@Req() request: AuthenticatedRequest) {
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateRevenueAnalytics(orgId, branchId);
	}

	@Get('sales/performance')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🎯 Get sales performance analytics',
		description: `
# Sales Performance Dashboard

Comprehensive sales team performance analysis including individual metrics, team comparisons, and goal tracking.

## 👥 **Team Performance**
- **Individual Metrics**: Sales rep performance breakdown
- **Team Comparison**: Comparative performance analysis
- **Goal Tracking**: Progress against sales targets
- **Activity Metrics**: Call volume, meetings, and follow-ups
- **Conversion Efficiency**: Lead to sale conversion rates
- **Revenue Contribution**: Individual revenue contribution

## 📊 **Performance Indicators**
- **Sales Velocity**: Average time from lead to close
- **Deal Size**: Average deal size by sales rep
- **Win Rate**: Successful deal closure percentage
- **Activity Volume**: Sales activities per rep
- **Pipeline Health**: Pipeline quality and progression
- **Customer Satisfaction**: Customer satisfaction scores

## 🏆 **Achievement Tracking**
- **Quota Attainment**: Percentage of quota achieved
- **Target Progress**: Progress toward monthly/quarterly targets
- **Performance Ranking**: Team member performance ranking
- **Achievement Trends**: Performance trends over time
		`,
	})
	@ApiOkResponse({
		description: '✅ Sales performance analytics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				teamSummary: {
					type: 'object',
					properties: {
						totalSalesReps: { type: 'number', example: 8 },
						averagePerformance: { type: 'number', example: 87.5 },
						topPerformer: { type: 'string', example: 'John Smith' },
						teamQuotaAttainment: { type: 'number', example: 95.2 },
					},
				},
				individualPerformance: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string', example: 'John Smith' },
							revenue: { type: 'number', example: 45000.00 },
							quotations: { type: 'number', example: 18 },
							conversionRate: { type: 'number', example: 85.7 },
							quotaAttainment: { type: 'number', example: 112.5 },
						},
					},
				},
				metrics: {
					type: 'object',
					properties: {
						averageDealSize: { type: 'number', example: 2500.00 },
						salesVelocity: { type: 'number', example: 14.2 },
						winRate: { type: 'number', example: 72.3 },
						pipelineValue: { type: 'number', example: 125000.00 },
					},
				},
			},
		},
	})
	async getSalesPerformance(@Req() request: AuthenticatedRequest) {
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateSalesPerformance(orgId, branchId);
	}

	@Get('sales/customers')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '👥 Get customer analytics',
		description: `
# Customer Analytics Dashboard

Comprehensive customer behavior analysis including acquisition, retention, and lifetime value metrics.

## 🎯 **Customer Metrics**
- **Total Customers**: Active customer count
- **Customer Acquisition**: New customer acquisition rate
- **Customer Retention**: Retention rate and churn analysis
- **Customer Lifetime Value**: Average CLV calculation
- **Purchase Frequency**: Average purchase frequency
- **Customer Satisfaction**: Satisfaction scores and feedback

## 📊 **Segmentation Analysis**
- **Customer Segments**: Segmentation by value, frequency, recency
- **Geographic Distribution**: Customer distribution by location
- **Product Preferences**: Product preference analysis
- **Behavior Patterns**: Purchase behavior patterns
- **Engagement Levels**: Customer engagement metrics
- **Risk Analysis**: Customer churn risk assessment

## 💰 **Value Analysis**
- **High-Value Customers**: Top customers by revenue
- **Revenue Concentration**: Revenue distribution analysis
- **Purchase Patterns**: Seasonal and periodic purchase patterns
- **Cross-Selling Opportunities**: Cross-selling potential analysis
		`,
	})
	@ApiOkResponse({
		description: '✅ Customer analytics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalCustomers: { type: 'number', example: 150 },
						newCustomers: { type: 'number', example: 12 },
						retentionRate: { type: 'number', example: 85.7 },
						averageLifetimeValue: { type: 'number', example: 15000.00 },
						averagePurchaseFrequency: { type: 'number', example: 3.2 },
					},
				},
				topCustomers: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string', example: 'Acme Corp' },
							revenue: { type: 'number', example: 25000.00 },
							orders: { type: 'number', example: 8 },
							lastOrder: { type: 'string', format: 'date' },
						},
					},
				},
				segments: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							segment: { type: 'string', example: 'High Value' },
							customers: { type: 'number', example: 25 },
							revenue: { type: 'number', example: 75000.00 },
							percentage: { type: 'number', example: 60.0 },
						},
					},
				},
			},
		},
	})
	async getCustomerAnalytics(@Req() request: AuthenticatedRequest) {
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateCustomerAnalytics(orgId, branchId);
	}

	@Get('sales/blank-quotations')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📄 Get blank quotation analytics',
		description: `
# Blank Quotation Analytics Dashboard

Specialized analytics for blank quotation performance, pricing strategy effectiveness, and conversion tracking.

## 📊 **Blank Quotation Metrics**
- **Total Blank Quotations**: Count of all blank quotations generated
- **Conversion Rate**: Blank quotation to order conversion percentage
- **Average Response Time**: Time between blank quotation creation and customer response
- **Price List Effectiveness**: Performance comparison across different price lists
- **Revenue Impact**: Total revenue generated from blank quotations
- **Customer Engagement**: Customer interaction patterns with blank quotations

## 🎯 **Pricing Strategy Analysis**
- **Premium vs Standard**: Comparison of premium vs standard pricing performance
- **Local vs Foreign**: Analysis of local vs foreign pricing effectiveness
- **Volume Discounts**: Impact of volume-based pricing on conversion
- **Competitive Analysis**: Pricing competitiveness and market positioning
- **Profit Margins**: Margin analysis across different pricing strategies

## 📈 **Conversion Funnel**
- **Creation to View**: Time from quotation creation to first customer view
- **View to Response**: Customer response time after viewing quotation
- **Response to Conversion**: Time from customer response to order placement
- **Abandoned Quotations**: Analysis of quotations that didn't convert
- **Follow-up Effectiveness**: Impact of follow-up activities on conversion

## 🔍 **Customer Insights**
- **Customer Segments**: Analysis of which customer segments respond best to blank quotations
- **Repeat Usage**: Customers who frequently request blank quotations
- **Geographic Patterns**: Regional performance of blank quotations
- **Industry Analysis**: Performance across different customer industries
		`,
	})
	@ApiOkResponse({
		description: '✅ Blank quotation analytics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				summary: {
					type: 'object',
					properties: {
						totalBlankQuotations: { type: 'number', example: 45 },
						conversionRate: { type: 'number', example: 72.2 },
						averageResponseTime: { type: 'number', example: 2.5 },
						totalRevenue: { type: 'number', example: 125000.00 },
						averageQuotationValue: { type: 'number', example: 2777.78 },
						mostEffectivePriceList: { type: 'string', example: 'premium' },
					},
				},
				priceListComparison: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							priceList: { type: 'string', example: 'premium' },
							quotations: { type: 'number', example: 15 },
							conversions: { type: 'number', example: 12 },
							conversionRate: { type: 'number', example: 80.0 },
							averageValue: { type: 'number', example: 3500.00 },
							totalRevenue: { type: 'number', example: 42000.00 },
						},
					},
				},
				conversionFunnel: {
					type: 'object',
					properties: {
						created: { type: 'number', example: 45 },
						viewed: { type: 'number', example: 38 },
						responded: { type: 'number', example: 35 },
						converted: { type: 'number', example: 32 },
						abandoned: { type: 'number', example: 13 },
					},
				},
				trends: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							date: { type: 'string', format: 'date' },
							quotations: { type: 'number' },
							conversions: { type: 'number' },
							revenue: { type: 'number' },
						},
					},
				},
			},
		},
	})
	async getBlankQuotationAnalytics(@Req() request: AuthenticatedRequest) {
		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateBlankQuotationAnalytics(orgId, branchId);
	}


}
