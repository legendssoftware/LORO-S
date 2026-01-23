import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { Lead } from './entities/lead.entity';
import { LeadStatus } from '../lib/enums/lead.enums';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { AccountStatus } from '../lib/enums/status.enums';
import { OrganizationHoursService } from '../attendance/services/organization.hours.service';
import { TimezoneUtil } from '../lib/utils/timezone.util';

@Injectable()
export class LeadsReminderService {
  private readonly logger = new Logger(LeadsReminderService.name);
  private isProcessing = false; // Prevent concurrent executions

  // Define inactive user statuses that should not receive notifications
  private readonly INACTIVE_USER_STATUSES = [
    AccountStatus.INACTIVE,
    AccountStatus.DELETED,
    AccountStatus.BANNED,
    AccountStatus.DECLINED,
  ];

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organisation)
    private readonly organisationRepository: Repository<Organisation>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly unifiedNotificationService: UnifiedNotificationService,
    private readonly organizationHoursService: OrganizationHoursService,
  ) {}

  /**
   * Check if database connection is healthy
   */
  private async isDatabaseConnected(): Promise<boolean> {
    try {
      if (!this.dataSource.isInitialized) {
        this.logger.warn('Database connection not initialized');
        return false;
      }

      // Try a simple query to test connection
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error(`Database connection check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a user is active and should receive notifications
   */
  private isUserActive(user: User): boolean {
    return !this.INACTIVE_USER_STATUSES.includes(user.status as AccountStatus);
  }

  /**
   * Filter active users from a list of users
   */
  private async filterActiveUsers(userIds: number[]): Promise<User[]> {
    if (userIds.length === 0) return [];

    const users = await this.userRepository.find({
      where: { uid: In(userIds) },
      select: ['uid', 'name', 'surname', 'email', 'status'],
    });

    const activeUsers = users.filter((user) => this.isUserActive(user));
    const filteredCount = userIds.length - activeUsers.length;

    if (filteredCount > 0) {
      this.logger.debug(`Filtered out ${filteredCount} inactive users from lead notifications`);
    }

    return activeUsers;
  }

  /**
   * Daily lead summary - Runs every hour and checks each organization's timezone
   * Sends notifications at 8:00 AM in each organization's timezone
   */
  @Cron('0 * * * *') // Run every hour
  async sendDailyLeadSummary() {
    // Prevent concurrent executions
    if (this.isProcessing) {
      this.logger.debug('Daily lead summary check already in progress, skipping...');
      return;
    }

    this.isProcessing = true;
    this.logger.log('Starting daily lead summary notification check...');

    try {
      // Check database connection first
      const isConnected = await this.isDatabaseConnected();
      if (!isConnected) {
        this.logger.warn('⚠️ Database connection not available, skipping daily lead summary check');
        return;
      }

      const serverNow = new Date();

      // Get all organizations
      const organizations = await this.organisationRepository.find({
        where: { isDeleted: false },
      });

      for (const org of organizations) {
        try {
          // Get organization timezone
          const orgId = org.clerkOrgId || org.ref;
          const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
          const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

          // Get current time in organization timezone
          const orgCurrentTime = TimezoneUtil.getCurrentOrganizationTime(organizationTimezone);
          const currentHour = orgCurrentTime.getHours();
          const currentMinute = orgCurrentTime.getMinutes();

          // Only send notifications at 8:00 AM in the organization's timezone (±30 minutes window)
          if (currentHour !== 8 || currentMinute > 30) {
            continue;
          }

          this.logger.debug(`Processing daily lead summary for org ${org.uid} (${org.name}) at their 8:00 AM`);

          // Calculate 7 days ago in organization timezone
          const sevenDaysAgo = TimezoneUtil.addMinutesInOrganizationTime(
            orgCurrentTime,
            -7 * 24 * 60,
            organizationTimezone
          );

          // Get all pending leads for this organization
          const pendingLeads = await this.leadRepository.find({
            where: {
              organisation: { uid: org.uid },
              status: LeadStatus.PENDING,
              isDeleted: false,
            },
            relations: ['owner', 'organisation'],
          });

          // Get all stale leads (not contacted in 7+ days or never contacted) for this organization
          const staleLeads = await this.leadRepository.find({
            where: [
              {
                organisation: { uid: org.uid },
                lastContactDate: null,
                isDeleted: false,
                status: LeadStatus.PENDING,
              },
            ],
            relations: ['owner', 'organisation'],
          });

          if (pendingLeads.length === 0 && staleLeads.length === 0) {
            this.logger.debug(`No leads to notify for org ${org.uid}`);
            continue;
          }

          // Group leads by owner
          const leadsByOwner = this.groupLeadsByOwner([...pendingLeads, ...staleLeads]);

          // Send consolidated notification to each user
          for (const [ownerClerkUserId, leads] of Object.entries(leadsByOwner)) {
            await this.sendConsolidatedLeadNotification(ownerClerkUserId, leads, sevenDaysAgo);
          }

          this.logger.log(`✅ Daily lead summary sent to ${Object.keys(leadsByOwner).length} users in org ${org.uid}`);
        } catch (error) {
          // Check if it's a timeout error
          if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
            this.logger.error(`Database timeout error processing org ${org.uid}: ${error.message}`);
            // Continue to next org instead of failing completely
            continue;
          }
          this.logger.error(`Error processing daily lead summary for org ${org.uid}:`, error.message);
        }
      }
    } catch (error) {
      // Check if it's a timeout error
      if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
        this.logger.error(`Database timeout error in daily lead summary check: ${error.message}`);
      } else {
        this.logger.error('Error in daily lead summary check:', error.stack);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Groups leads by their owner
   */
  private groupLeadsByOwner(leads: Lead[]): Record<string, Lead[]> {
    const leadsByOwner: Record<string, Lead[]> = {};

    for (const lead of leads) {
      if (!lead.ownerClerkUserId) continue;

      if (!leadsByOwner[lead.ownerClerkUserId]) {
        leadsByOwner[lead.ownerClerkUserId] = [];
      }

      leadsByOwner[lead.ownerClerkUserId].push(lead);
    }

    return leadsByOwner;
  }

  /**
   * Send consolidated lead notification to a user
   */
  private async sendConsolidatedLeadNotification(ownerClerkUserId: string, leads: Lead[], sevenDaysAgo: Date) {
    let user: User | null = null;
    try {
      // Look up user by clerkUserId
      user = await this.userRepository.findOne({
        where: { clerkUserId: ownerClerkUserId },
        select: ['uid', 'name', 'surname', 'email', 'status'],
      });

      if (!user) {
        this.logger.debug(`User with clerkUserId ${ownerClerkUserId} not found, skipping notification`);
        return;
      }

      // Check if user is active
      if (!this.isUserActive(user)) {
        this.logger.debug(`User ${user.uid} (clerkUserId: ${ownerClerkUserId}) is inactive, skipping notification`);
        return;
      }
      const now = new Date();

      // Categorize leads
      const pendingLeads = leads.filter((lead) => lead.status === LeadStatus.PENDING);
      const staleLeads = leads.filter(
        (lead) =>
          !lead.lastContactDate ||
          (lead.lastContactDate && lead.lastContactDate < sevenDaysAgo)
      );
      const neverContactedLeads = leads.filter((lead) => !lead.lastContactDate);
      const hotLeads = leads.filter((lead) => lead.temperature === 'HOT');
      const highPriorityLeads = leads.filter((lead) => lead.priority === 'HIGH' || lead.priority === 'CRITICAL');

      // Calculate total estimated value
      const totalEstimatedValue = leads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);

      // Get top 5 most urgent leads (by priority and temperature)
      const sortedLeads = [...leads].sort((a, b) => {
        const priorityOrder = { URGENT: 0, CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        const temperatureOrder = { HOT: 0, WARM: 1, COLD: 2, FROZEN: 3 };
        
        const priorityDiff = (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
        if (priorityDiff !== 0) return priorityDiff;
        
        return (temperatureOrder[a.temperature] || 3) - (temperatureOrder[b.temperature] || 3);
      });
      const topLeads = sortedLeads.slice(0, 5);

      // Only send notification if there are actionable leads
      if (pendingLeads.length === 0 && staleLeads.length === 0) {
        this.logger.debug(`No actionable leads for user ${user.uid} (clerkUserId: ${ownerClerkUserId}), skipping notification`);
        return;
      }

      await this.unifiedNotificationService.sendTemplatedNotification(
        NotificationEvent.LEAD_DAILY_SUMMARY,
        [user.uid],
        {
          userName: user.name || 'Team Member',
          totalLeads: leads.length,
          pendingCount: pendingLeads.length,
          staleCount: staleLeads.length,
          neverContactedCount: neverContactedLeads.length,
          hotCount: hotLeads.length,
          highPriorityCount: highPriorityLeads.length,
          totalEstimatedValue: totalEstimatedValue.toLocaleString('en-ZA', {
            style: 'currency',
            currency: 'ZAR',
          }),
          topLeads: topLeads.map((lead) => ({
            id: lead.uid,
            name: lead.name || 'Unnamed Lead',
            company: lead.companyName,
            temperature: lead.temperature,
            priority: lead.priority,
            estimatedValue: lead.estimatedValue || 0,
            daysSinceLastContact: lead.lastContactDate
              ? Math.floor((now.getTime() - lead.lastContactDate.getTime()) / (24 * 60 * 60 * 1000))
              : 'Never',
          })),
        },
        {
          priority: hotLeads.length > 0 || highPriorityLeads.length > 0 
            ? NotificationPriority.HIGH 
            : NotificationPriority.NORMAL,
        },
      );

      this.logger.debug(
        `✅ Daily lead summary sent to user ${user.uid} (clerkUserId: ${ownerClerkUserId}): ${leads.length} leads (${pendingLeads.length} pending, ${staleLeads.length} stale)`
      );
    } catch (error) {
      this.logger.error(`Error sending consolidated lead notification to user ${user?.uid || ownerClerkUserId} (clerkUserId: ${ownerClerkUserId})`, error.stack);
    }
  }
} 