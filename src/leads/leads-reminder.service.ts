import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Lead } from './entities/lead.entity';
import { LeadStatus } from '../lib/enums/lead.enums';
import { User } from '../user/entities/user.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { AccountStatus } from '../lib/enums/status.enums';

@Injectable()
export class LeadsReminderService {
  private readonly logger = new Logger(LeadsReminderService.name);

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
    private readonly unifiedNotificationService: UnifiedNotificationService,
  ) {}

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
   * Daily lead summary - Runs at 8:00 AM
   * Sends ONE consolidated push notification per user with all their leads (pending + stale)
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendDailyLeadSummary() {
    this.logger.log('Starting daily lead summary notification...');

    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get all pending leads
      const pendingLeads = await this.leadRepository.find({
        where: {
          status: LeadStatus.PENDING,
          isDeleted: false,
        },
        relations: ['owner'],
      });

      // Get all stale leads (not contacted in 7+ days or never contacted)
      const staleLeads = await this.leadRepository.find({
        where: [
          {
            lastContactDate: null,
            isDeleted: false,
            status: LeadStatus.PENDING,
          },
        ],
        relations: ['owner'],
      });

      // Group leads by owner
      const leadsByOwner = this.groupLeadsByOwner([...pendingLeads, ...staleLeads]);

      // Send consolidated notification to each user
      for (const [ownerUid, leads] of Object.entries(leadsByOwner)) {
        await this.sendConsolidatedLeadNotification(parseInt(ownerUid), leads, sevenDaysAgo);
      }

      this.logger.log(`✅ Daily lead summary sent to ${Object.keys(leadsByOwner).length} users`);
    } catch (error) {
      this.logger.error('Failed to process daily lead summary', error.stack);
    }
  }

  /**
   * Groups leads by their owner
   */
  private groupLeadsByOwner(leads: Lead[]): Record<number, Lead[]> {
    const leadsByOwner: Record<number, Lead[]> = {};

    for (const lead of leads) {
      if (!lead.ownerUid) continue;

      if (!leadsByOwner[lead.ownerUid]) {
        leadsByOwner[lead.ownerUid] = [];
      }

      leadsByOwner[lead.ownerUid].push(lead);
    }

    return leadsByOwner;
  }

  /**
   * Send consolidated lead notification to a user
   */
  private async sendConsolidatedLeadNotification(ownerUid: number, leads: Lead[], sevenDaysAgo: Date) {
    try {
      // Check if user is active
      const activeUsers = await this.filterActiveUsers([ownerUid]);
      if (activeUsers.length === 0) {
        this.logger.debug(`User ${ownerUid} is inactive, skipping notification`);
        return;
      }

      const user = activeUsers[0];
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
        this.logger.debug(`No actionable leads for user ${ownerUid}, skipping notification`);
        return;
      }

      await this.unifiedNotificationService.sendTemplatedNotification(
        NotificationEvent.LEAD_DAILY_SUMMARY,
        [ownerUid],
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
        `✅ Daily lead summary sent to user ${ownerUid}: ${leads.length} leads (${pendingLeads.length} pending, ${staleLeads.length} stale)`
      );
    } catch (error) {
      this.logger.error(`Error sending consolidated lead notification to user ${ownerUid}`, error.stack);
    }
  }
} 