import { Controller, Get, UseGuards, Req, BadRequestException, Logger, Query, ValidationPipe } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
	ApiOkResponse,
	ApiBadRequestResponse,
	ApiUnauthorizedResponse,
	ApiQuery,
} from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { PerformanceFiltersDto } from './dto/performance-filters.dto';

@ApiBearerAuth('JWT-auth')
@ApiTags('📊 Reports')
@Controller('reports')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class ReportsController {
	private readonly logger = new Logger(ReportsController.name);

	constructor(private readonly reportsService: ReportsService) {}

	// Get Map Data endpoint
	@Get('map')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🗺️ Get map data for visualization',
		description: `
# Map Data Dashboard

Real-time map visualization data including employee locations, client locations, and business metrics.

## 🗺️ **Map Visualization Data**
- **Employee Locations**: Real-time employee locations with check-in status
- **Client Locations**: Active client locations with detailed information
- **Competitor Locations**: Competitor mapping with threat analysis
- **Quotation Locations**: Recent quotations mapped to client locations
- **Recent Events**: Timeline of recent activities (check-ins, tasks, leads, etc.)
- **Territory Mapping**: Sales territory visualization
- **Performance Mapping**: Performance metrics by location

## 📊 **Location Analytics**
- **Geographic Distribution**: Entity distribution by location
- **Density Analysis**: Concentration of activities
- **Route Optimization**: Optimal route planning
- **Territory Performance**: Performance by territory
- **Market Coverage**: Market coverage analysis
- **Travel Patterns**: Employee travel patterns

## 🔧 **Query Parameters**
- **orgId**: Override organization ID (optional, defaults to user's org)
- **branchId**: Filter by specific branch (optional)
- **userId**: User context for authorization (optional)
		`,
	})
	@ApiQuery({
		name: 'orgId',
		required: false,
		type: String,
		description: 'Organization ID to filter data (defaults to user organization)',
	})
	@ApiQuery({
		name: 'branchId',
		required: false,
		type: String,
		description: 'Branch ID to filter data (optional)',
	})
	@ApiQuery({
		name: 'userId',
		required: false,
		type: String,
		description: 'User ID for authorization context (optional)',
	})
	@ApiOkResponse({
		description: 'Map data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						workers: { 
							type: 'array',
							description: 'Array of workers with location data and check-in status'
						},
						clients: { 
							type: 'array',
							description: 'Array of clients with comprehensive business information'
						},
						competitors: { 
							type: 'array',
							description: 'Array of competitors with threat analysis data'
						},
						quotations: { 
							type: 'array',
							description: 'Array of recent quotations mapped to client locations'
						},
						events: { 
							type: 'array',
							description: 'Array of recent events (check-ins, tasks, leads, etc.)'
						},
						mapConfig: {
							type: 'object',
							description: 'Map configuration including default center and regions',
							properties: {
								defaultCenter: {
									type: 'object',
									properties: {
										lat: { type: 'number' },
										lng: { type: 'number' }
									}
								},
								orgRegions: { type: 'array' }
							}
						}
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
		description: 'Bad Request - Invalid parameters or missing organization ID',
	})
	async getMapData(
		@Req() request: AuthenticatedRequest,
		@Query('orgId') queryOrgId?: string,
		@Query('branchId') queryBranchId?: string,
		@Query('userId') queryUserId?: string
	) {
		this.logger.log(`Getting map data - Query params: orgId=${queryOrgId}, branchId=${queryBranchId}, userId=${queryUserId}`);

		// Use query parameters or fall back to user's organization/branch
		const orgId = queryOrgId ? parseInt(queryOrgId, 10) : (request.user.org?.uid || request.user.organisationRef);
		const branchId = queryBranchId ? parseInt(queryBranchId, 10) : request.user.branch?.uid;
		const userId = queryUserId ? parseInt(queryUserId, 10) : request.user.uid;

		this.logger.debug(`Resolved parameters - orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}`);

		if (!orgId) {
			this.logger.error('Organization ID is required for map data generation');
			throw new BadRequestException('Organization ID is required');
		}

		// Validate numeric parameters
		if (isNaN(orgId)) {
			this.logger.error(`Invalid organization ID: ${queryOrgId}`);
			throw new BadRequestException('Organization ID must be a valid number');
		}

		if (queryBranchId && isNaN(branchId)) {
			this.logger.error(`Invalid branch ID: ${queryBranchId}`);
			throw new BadRequestException('Branch ID must be a valid number');
		}

		if (queryUserId && isNaN(userId)) {
			this.logger.error(`Invalid user ID: ${queryUserId}`);
			throw new BadRequestException('User ID must be a valid number');
		}

		this.logger.log(`Generating map data for organisation ${orgId}${branchId ? `, branch ${branchId}` : ''}${userId ? `, user ${userId}` : ''}`);

		return this.reportsService.generateMapData({ 
			organisationId: orgId, 
			branchId,
			userId
		});
	}

	// Get Organization Metrics endpoint
	@Get('organization/metrics')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.HR)
	@ApiOperation({
		summary: '📊 Get organization-wide metrics summary',
		description: `
# Organization Metrics Dashboard

Comprehensive real-time metrics for the entire organization or specific branch.

## 📊 **Metrics Included**
- **Attendance**: Present/absent employees, total hours, punctuality rate
- **Leads**: Total leads, new leads today, conversion rate, hot leads
- **Claims**: Total claims, pending/approved/rejected counts, total value
- **Tasks**: Total tasks, completed/overdue/in-progress counts, completion rate
- **Sales**: Total quotations, revenue, average value, accepted/pending counts
- **Leave**: Active requests, pending approvals, employees on leave
- **IoT**: Connected devices, online/offline status, maintenance alerts

## 🔧 **Query Parameters**
- **branchId**: Filter metrics by specific branch (optional, defaults to organization-wide)

## 🔒 **Authorization**
- Restricted to ADMIN, MANAGER, OWNER, and HR roles only
- Token is automatically extracted from Authorization header
- Organization ID is extracted from authenticated user context
		`,
	})
	@ApiQuery({
		name: 'branchId',
		required: false,
		type: String,
		description: 'Branch ID to filter metrics (optional, defaults to organization-wide metrics)',
	})
	@ApiOkResponse({
		description: 'Organization metrics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				organizationId: { type: 'number', example: 1 },
				organizationName: { type: 'string', example: 'Acme Corp' },
				branchId: { type: 'number', nullable: true, example: null },
				branchName: { type: 'string', nullable: true, example: null },
				generatedAt: { type: 'string', format: 'date-time' },
				fromCache: { type: 'boolean', example: false },
				attendance: {
					type: 'object',
					properties: {
						presentToday: { type: 'number', example: 42 },
						absentToday: { type: 'number', example: 8 },
						totalHoursToday: { type: 'number', example: 336.5 },
						averageHoursPerEmployee: { type: 'number', example: 8.01 },
						punctualityRate: { type: 'number', example: 85.71 },
						lateCheckIns: { type: 'number', example: 6 },
					},
				},
				leads: {
					type: 'object',
					properties: {
						totalLeads: { type: 'number', example: 156 },
						newLeadsToday: { type: 'number', example: 12 },
						leadsByStatus: { 
							type: 'object',
							example: { PENDING: 45, CONTACTED: 32, WON: 28, LOST: 15 }
						},
						conversionRate: { type: 'number', example: 17.95 },
						hotLeads: { type: 'number', example: 23 },
					},
				},
				claims: {
					type: 'object',
					properties: {
						totalClaims: { type: 'number', example: 34 },
						pendingClaims: { type: 'number', example: 12 },
						approvedClaims: { type: 'number', example: 18 },
						rejectedClaims: { type: 'number', example: 4 },
						totalClaimValue: { type: 'number', example: 45600.75 },
						claimsToday: { type: 'number', example: 3 },
					},
				},
				tasks: {
					type: 'object',
					properties: {
						totalTasks: { type: 'number', example: 89 },
						completedTasks: { type: 'number', example: 52 },
						overdueTasks: { type: 'number', example: 7 },
						inProgressTasks: { type: 'number', example: 30 },
						completionRate: { type: 'number', example: 58.43 },
						tasksCreatedToday: { type: 'number', example: 5 },
					},
				},
				sales: {
					type: 'object',
					properties: {
						totalQuotations: { type: 'number', example: 67 },
						totalRevenue: { type: 'number', example: 234567.89 },
						averageQuotationValue: { type: 'number', example: 3501.46 },
						quotationsToday: { type: 'number', example: 4 },
						acceptedQuotations: { type: 'number', example: 31 },
						pendingQuotations: { type: 'number', example: 24 },
					},
				},
				leave: {
					type: 'object',
					properties: {
						activeLeaveRequests: { type: 'number', example: 5 },
						pendingApprovals: { type: 'number', example: 2 },
						approvedLeave: { type: 'number', example: 3 },
						rejectedLeave: { type: 'number', example: 0 },
						employeesOnLeaveToday: { type: 'number', example: 3 },
					},
				},
				iot: {
					type: 'object',
					properties: {
						totalDevices: { type: 'number', example: 0 },
						onlineDevices: { type: 'number', example: 0 },
						offlineDevices: { type: 'number', example: 0 },
						maintenanceRequired: { type: 'number', example: 0 },
						dataPointsToday: { type: 'number', example: 0 },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters',
	})
	async getOrganizationMetrics(
		@Req() request: AuthenticatedRequest,
		@Query('branchId') queryBranchId?: string
	) {
		this.logger.log(`Getting organization metrics - branchId=${queryBranchId}`);

		// Extract organization ID from authenticated user context
		const orgId = request.user?.org?.uid || request.user?.organisationRef;
		const branchId = queryBranchId ? parseInt(queryBranchId, 10) : undefined;

		this.logger.debug(`Resolved parameters - orgId: ${orgId}, branchId: ${branchId}`);

		if (!orgId) {
			this.logger.error('Organization ID is required for metrics');
			throw new BadRequestException('Organization ID is required');
		}

		// Validate numeric parameters
		if (typeof orgId !== 'number' || isNaN(orgId)) {
			this.logger.error(`Invalid organization ID: ${orgId}`);
			throw new BadRequestException('Invalid organization ID');
		}

		if (queryBranchId && isNaN(branchId)) {
			this.logger.error(`Invalid branch ID: ${queryBranchId}`);
			throw new BadRequestException('Branch ID must be a valid number');
		}

		this.logger.log(`Fetching organization metrics for org ${orgId}${branchId ? `, branch ${branchId}` : ''}`);

		return this.reportsService.getOrganizationMetricsSummary(orgId, branchId);
	}

	// ======================================================
	// PERFORMANCE TRACKER ENDPOINTS
	// ======================================================

	@Get('performance')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.USER)
	@ApiOperation({
		summary: '🚀 Get ALL Performance Data (UNIFIED ENDPOINT)',
		description: `
# 🎯 UNIFIED Performance Tracker - One Endpoint for Everything

**THIS IS THE MAIN ENDPOINT FOR MOBILE APP** - Returns ALL performance data in a single call.

## 📦 **What You Get (All in One Response)**

### 1. Dashboard Data
- **Summary Metrics**: Revenue, targets, performance rates, transaction counts
- **Revenue Trends**: Time-series revenue analysis
- **Hourly Sales**: Sales patterns throughout the day  
- **Category Performance**: Sales distribution by product category
- **Branch Performance**: Top 10 performing branches
- **Top Products**: Best-selling products
- **Salesperson Performance**: Individual salesperson metrics
- **Conversion Rates**: Quotation to sales conversion
- **Customer Composition**: Customer type distribution

### 2. Daily Sales Performance
- Date-by-date breakdown
- Basket counts and values
- Client quantities
- Sales revenue and gross profit

### 3. Branch × Category Performance
- Performance matrix showing sales by branch and category
- Comprehensive metrics per branch per category

### 4. Sales Per Store
- Aggregated sales data for each store/branch
- Transaction counts, revenue, items sold, unique clients

### 5. Master Data (for Filters)
- Locations (33 Southern African locations)
- Branches (33 branches)
- Products (30 building materials)
- Product Categories (5 categories)
- Sales People (66 salespeople)

## 🔍 **Filtering Options**
All filters apply to ALL data sections:
- **Date Range**: Filter by start and end dates
- **Location**: Filter by county, province, city, suburb
- **Branch**: Filter by specific branches
- **Products**: Filter by category or specific products
- **Price Range**: Filter by min/max price
- **Salesperson**: Filter by specific salespeople

## 📊 **Data Generation**
- **Phase 1 (Current)**: Server-side mock data with realistic patterns
- **Phase 2 (Future)**: External database queries with real data

## 🔒 **Authorization**
- Available to ADMIN, MANAGER, OWNER, and USER roles
- Organization ID is required

## ⚡ **Performance**
- Cached for better performance
- All data generated in parallel
- Single network call from mobile app
		`,
	})
	@ApiQuery({ name: 'organisationId', required: true, type: Number })
	@ApiQuery({ name: 'branchId', required: false, type: Number })
	@ApiQuery({ name: 'startDate', required: false, type: String, description: 'YYYY-MM-DD format' })
	@ApiQuery({ name: 'endDate', required: false, type: String, description: 'YYYY-MM-DD format' })
	@ApiQuery({ name: 'branchIds', required: false, type: String, description: 'Comma-separated branch IDs' })
	@ApiQuery({ name: 'salesPersonIds', required: false, type: String, description: 'Comma-separated salesperson IDs' })
	@ApiQuery({ name: 'category', required: false, type: String })
	@ApiQuery({ name: 'productIds', required: false, type: String, description: 'Comma-separated product IDs' })
	@ApiQuery({ name: 'minPrice', required: false, type: Number })
	@ApiQuery({ name: 'maxPrice', required: false, type: Number })
	@ApiQuery({ name: 'county', required: false, type: String })
	@ApiQuery({ name: 'province', required: false, type: String })
	@ApiQuery({ name: 'city', required: false, type: String })
	@ApiQuery({ name: 'suburb', required: false, type: String })
	async getUnifiedPerformanceData(
		@Req() request: AuthenticatedRequest,
		@Query(new ValidationPipe({ transform: true })) filters: PerformanceFiltersDto
	) {
		this.logger.log(`🚀 Getting UNIFIED performance data for org ${filters.organisationId}`);

		// Validate organization access
		const userOrgId = request.user?.org?.uid || request.user?.organisationRef;
		if (filters.organisationId !== userOrgId && request.user.accessLevel !== AccessLevel.OWNER) {
			this.logger.warn(`User ${request.user.uid} attempted to access org ${filters.organisationId} data without permission`);
			throw new BadRequestException('Access denied to requested organization data');
		}

		return this.reportsService.getUnifiedPerformanceData(filters);
	}

	@Get('performance/dashboard')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.USER)
	@ApiOperation({
		summary: '📊 Get Performance Dashboard Data',
		description: `
# Performance Tracker Dashboard

Comprehensive performance analytics with advanced filtering and data visualization.

## 📊 **Dashboard Components**
- **Summary Metrics**: Revenue, targets, performance rates, transaction counts
- **Revenue Trends**: Time-series revenue analysis
- **Hourly Sales**: Sales patterns throughout the day
- **Category Performance**: Sales distribution by product category
- **Branch Performance**: Top 10 performing branches
- **Top Products**: Best-selling products
- **Salesperson Performance**: Individual salesperson metrics
- **Conversion Rates**: Quotation to sales conversion
- **Customer Composition**: Customer type distribution

## 🔍 **Filtering Options**
- **Date Range**: Filter by start and end dates
- **Location**: Filter by county, province, city, suburb
- **Branch**: Filter by specific branches
- **Products**: Filter by category or specific products
- **Price Range**: Filter by min/max price
- **Salesperson**: Filter by specific salespeople

## 🔒 **Authorization**
- Available to ADMIN, MANAGER, OWNER, and USER roles
- Organization ID is required
		`,
	})
	@ApiQuery({ name: 'organisationId', required: true, type: Number })
	@ApiQuery({ name: 'branchId', required: false, type: Number })
	@ApiQuery({ name: 'startDate', required: false, type: String, description: 'YYYY-MM-DD format' })
	@ApiQuery({ name: 'endDate', required: false, type: String, description: 'YYYY-MM-DD format' })
	@ApiQuery({ name: 'branchIds', required: false, type: String, description: 'Comma-separated branch IDs' })
	@ApiQuery({ name: 'salesPersonIds', required: false, type: String, description: 'Comma-separated salesperson IDs' })
	@ApiQuery({ name: 'category', required: false, type: String })
	@ApiQuery({ name: 'productIds', required: false, type: String, description: 'Comma-separated product IDs' })
	@ApiQuery({ name: 'minPrice', required: false, type: Number })
	@ApiQuery({ name: 'maxPrice', required: false, type: Number })
	@ApiQuery({ name: 'county', required: false, type: String })
	@ApiQuery({ name: 'province', required: false, type: String })
	@ApiQuery({ name: 'city', required: false, type: String })
	@ApiQuery({ name: 'suburb', required: false, type: String })
	async getPerformanceDashboard(
		@Req() request: AuthenticatedRequest,
		@Query(new ValidationPipe({ transform: true })) filters: PerformanceFiltersDto
	) {
		this.logger.log(`Getting performance dashboard for org ${filters.organisationId}`);

		// Validate organization access
		const userOrgId = request.user?.org?.uid || request.user?.organisationRef;
		if (filters.organisationId !== userOrgId && request.user.accessLevel !== AccessLevel.OWNER) {
			this.logger.warn(`User ${request.user.uid} attempted to access org ${filters.organisationId} data without permission`);
			throw new BadRequestException('Access denied to requested organization data');
		}

		return this.reportsService.getPerformanceDashboard(filters);
	}

	@Get('performance/daily-sales')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📊 Get Daily Sales Performance',
		description: 'Get detailed daily sales performance data with basket counts, sales revenue, and gross profit metrics.',
	})
	@ApiQuery({ name: 'organisationId', required: true, type: Number })
	@ApiQuery({ name: 'startDate', required: false, type: String })
	@ApiQuery({ name: 'endDate', required: false, type: String })
	async getDailySalesPerformance(
		@Req() request: AuthenticatedRequest,
		@Query(new ValidationPipe({ transform: true })) filters: PerformanceFiltersDto
	) {
		this.logger.log(`Getting daily sales performance for org ${filters.organisationId}`);

		const userOrgId = request.user?.org?.uid || request.user?.organisationRef;
		if (filters.organisationId !== userOrgId && request.user.accessLevel !== AccessLevel.OWNER) {
			throw new BadRequestException('Access denied to requested organization data');
		}

		return this.reportsService.getDailySalesPerformance(filters);
	}

	@Get('performance/branch-category')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📊 Get Branch × Category Performance',
		description: 'Get performance matrix showing sales by branch and product category.',
	})
	@ApiQuery({ name: 'organisationId', required: true, type: Number })
	@ApiQuery({ name: 'startDate', required: false, type: String })
	@ApiQuery({ name: 'endDate', required: false, type: String })
	async getBranchCategoryPerformance(
		@Req() request: AuthenticatedRequest,
		@Query(new ValidationPipe({ transform: true })) filters: PerformanceFiltersDto
	) {
		this.logger.log(`Getting branch-category performance for org ${filters.organisationId}`);

		const userOrgId = request.user?.org?.uid || request.user?.organisationRef;
		if (filters.organisationId !== userOrgId && request.user.accessLevel !== AccessLevel.OWNER) {
			throw new BadRequestException('Access denied to requested organization data');
		}

		return this.reportsService.getBranchCategoryPerformance(filters);
	}

	@Get('performance/sales-per-store')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📊 Get Sales Per Store',
		description: 'Get aggregated sales data for each store/branch.',
	})
	@ApiQuery({ name: 'organisationId', required: true, type: Number })
	@ApiQuery({ name: 'startDate', required: false, type: String })
	@ApiQuery({ name: 'endDate', required: false, type: String })
	async getSalesPerStore(
		@Req() request: AuthenticatedRequest,
		@Query(new ValidationPipe({ transform: true })) filters: PerformanceFiltersDto
	) {
		this.logger.log(`Getting sales per store for org ${filters.organisationId}`);

		const userOrgId = request.user?.org?.uid || request.user?.organisationRef;
		if (filters.organisationId !== userOrgId && request.user.accessLevel !== AccessLevel.OWNER) {
			throw new BadRequestException('Access denied to requested organization data');
		}

		return this.reportsService.getSalesPerStore(filters);
	}

	@Get('performance/meta')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.USER)
	@ApiOperation({
		summary: '📊 Get Performance Master Data',
		description: 'Get master data for filters: branches, products, categories, locations, salespeople.',
	})
	@ApiQuery({ name: 'organisationId', required: true, type: Number })
	async getPerformanceMasterData(
		@Req() request: AuthenticatedRequest,
		@Query('organisationId') organisationId: number
	) {
		this.logger.log(`Getting performance master data for org ${organisationId}`);

		const userOrgId = request.user?.org?.uid || request.user?.organisationRef;
		if (organisationId !== userOrgId && request.user.accessLevel !== AccessLevel.OWNER) {
			throw new BadRequestException('Access denied to requested organization data');
		}

		return this.reportsService.getPerformanceMasterData(organisationId);
	}
}
