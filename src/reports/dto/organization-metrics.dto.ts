import { ApiProperty } from '@nestjs/swagger';

export class AttendanceMetricsDto {
  @ApiProperty({ description: 'Total employees present today' })
  presentToday: number;

  @ApiProperty({ description: 'Total employees absent today' })
  absentToday: number;

  @ApiProperty({ description: 'Total hours worked today across organization' })
  totalHoursToday: number;

  @ApiProperty({ description: 'Average hours per employee' })
  averageHoursPerEmployee: number;

  @ApiProperty({ description: 'Punctuality rate percentage' })
  punctualityRate: number;

  @ApiProperty({ description: 'Late check-ins count' })
  lateCheckIns: number;
}

export class LeadsMetricsDto {
  @ApiProperty({ description: 'Total leads in the system' })
  totalLeads: number;

  @ApiProperty({ description: 'New leads today' })
  newLeadsToday: number;

  @ApiProperty({ description: 'Leads by status breakdown' })
  leadsByStatus: Record<string, number>;

  @ApiProperty({ description: 'Conversion rate percentage' })
  conversionRate: number;

  @ApiProperty({ description: 'Hot leads count' })
  hotLeads: number;
}

export class ClaimsMetricsDto {
  @ApiProperty({ description: 'Total claims' })
  totalClaims: number;

  @ApiProperty({ description: 'Pending claims count' })
  pendingClaims: number;

  @ApiProperty({ description: 'Approved claims count' })
  approvedClaims: number;

  @ApiProperty({ description: 'Rejected claims count' })
  rejectedClaims: number;

  @ApiProperty({ description: 'Total claim value' })
  totalClaimValue: number;

  @ApiProperty({ description: 'Claims submitted today' })
  claimsToday: number;
}

export class TasksMetricsDto {
  @ApiProperty({ description: 'Total tasks' })
  totalTasks: number;

  @ApiProperty({ description: 'Completed tasks count' })
  completedTasks: number;

  @ApiProperty({ description: 'Overdue tasks count' })
  overdueTasks: number;

  @ApiProperty({ description: 'In progress tasks count' })
  inProgressTasks: number;

  @ApiProperty({ description: 'Task completion rate percentage' })
  completionRate: number;

  @ApiProperty({ description: 'Tasks created today' })
  tasksCreatedToday: number;
}

export class SalesMetricsDto {
  @ApiProperty({ description: 'Total quotations' })
  totalQuotations: number;

  @ApiProperty({ description: 'Total revenue from quotations' })
  totalRevenue: number;

  @ApiProperty({ description: 'Average quotation value' })
  averageQuotationValue: number;

  @ApiProperty({ description: 'Quotations created today' })
  quotationsToday: number;

  @ApiProperty({ description: 'Accepted quotations count' })
  acceptedQuotations: number;

  @ApiProperty({ description: 'Pending quotations count' })
  pendingQuotations: number;
}

export class LeaveMetricsDto {
  @ApiProperty({ description: 'Active leave requests count' })
  activeLeaveRequests: number;

  @ApiProperty({ description: 'Pending leave approvals count' })
  pendingApprovals: number;

  @ApiProperty({ description: 'Approved leave count' })
  approvedLeave: number;

  @ApiProperty({ description: 'Rejected leave count' })
  rejectedLeave: number;

  @ApiProperty({ description: 'Employees on leave today' })
  employeesOnLeaveToday: number;
}

export class IoTMetricsDto {
  @ApiProperty({ description: 'Total IoT devices' })
  totalDevices: number;

  @ApiProperty({ description: 'Online devices count' })
  onlineDevices: number;

  @ApiProperty({ description: 'Offline devices count' })
  offlineDevices: number;

  @ApiProperty({ description: 'Devices needing maintenance' })
  maintenanceRequired: number;

  @ApiProperty({ description: 'Total data points collected today' })
  dataPointsToday: number;
}

export class OrganizationMetricsSummaryDto {
  @ApiProperty({ description: 'Organization ID' })
  organizationId: number;

  @ApiProperty({ description: 'Organization name' })
  organizationName: string;

  @ApiProperty({ description: 'Branch ID if filtered by branch' })
  branchId?: number;

  @ApiProperty({ description: 'Branch name if filtered by branch' })
  branchName?: string;

  @ApiProperty({ description: 'Timestamp when metrics were generated' })
  generatedAt: Date;

  @ApiProperty({ description: 'Attendance metrics', type: AttendanceMetricsDto })
  attendance: AttendanceMetricsDto;

  @ApiProperty({ description: 'Leads metrics', type: LeadsMetricsDto })
  leads: LeadsMetricsDto;

  @ApiProperty({ description: 'Claims metrics', type: ClaimsMetricsDto })
  claims: ClaimsMetricsDto;

  @ApiProperty({ description: 'Tasks metrics', type: TasksMetricsDto })
  tasks: TasksMetricsDto;

  @ApiProperty({ description: 'Sales metrics', type: SalesMetricsDto })
  sales: SalesMetricsDto;

  @ApiProperty({ description: 'Leave metrics', type: LeaveMetricsDto })
  leave: LeaveMetricsDto;

  @ApiProperty({ description: 'IoT metrics', type: IoTMetricsDto })
  iot: IoTMetricsDto;

  @ApiProperty({ description: 'Whether data is from cache' })
  fromCache?: boolean;
}

