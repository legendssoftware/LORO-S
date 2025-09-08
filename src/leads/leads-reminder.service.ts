import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from './entities/lead.entity';
import { LeadStatus } from '../lib/enums/lead.enums';
import { EmailType } from '../lib/enums/email.enums';
import { User } from '../user/entities/user.entity';
import { CommunicationService } from '../communication/communication.service';

@Injectable()
export class LeadsReminderService {
  private readonly logger = new Logger(LeadsReminderService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly communicationService: CommunicationService,
  ) {}

  /**
   * Cron job that runs daily at 5:00 AM to check for pending leads
   * and send reminder emails to lead owners
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async handlePendingLeadsReminders() {
    this.logger.log('Starting pending leads reminder check...');

    try {
      // Get all leads with PENDING status
      const pendingLeads = await this.leadRepository.find({
        where: {
          status: LeadStatus.PENDING,
          isDeleted: false,
        },
        relations: ['owner'],
      });

      if (pendingLeads.length === 0) {
        this.logger.log('No pending leads found.');
        return;
      }

      this.logger.log(`Found ${pendingLeads.length} pending leads.`);

      // Group leads by owner
      const leadsByOwner = this.groupLeadsByOwner(pendingLeads);

      // Process each owner's leads and send reminders
      for (const [ownerUid, leads] of Object.entries(leadsByOwner)) {
        await this.sendReminderEmail(parseInt(ownerUid), leads);
      }

      this.logger.log('Pending leads reminder process completed successfully.');
    } catch (error) {
      this.logger.error('Failed to process pending leads reminders', error.stack);
    }
  }

  /**
   * Cron job that runs daily at 5:00 AM to check for stale leads
   * and send reminder emails to lead creators
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM) // Daily at 5:00 AM
  async handleWeeklyStaleLeadsReminders() {
    this.logger.log('Starting weekly stale leads reminder check...');

    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get all leads that are stale (haven't been contacted in 7+ days or never contacted)
      const staleLeads = await this.leadRepository.find({
        where: [
          {
            // Never contacted leads that are older than 7 days
            lastContactDate: null,
            isDeleted: false,
            status: LeadStatus.PENDING,
            createdAt: sevenDaysAgo,
          },
          {
            // Leads that haven't been contacted in 7+ days
            lastContactDate: sevenDaysAgo,
            isDeleted: false,
            status: LeadStatus.PENDING,
          },
        ],
        relations: ['owner'],
      });

      if (staleLeads.length === 0) {
        this.logger.log('No stale leads found for weekly reminder.');
        return;
      }

      this.logger.log(`Found ${staleLeads.length} stale leads for weekly reminder.`);

      // Group leads by their creator/owner
      const leadsByCreator = this.groupLeadsByOwner(staleLeads);

      // Process each creator's leads and send reminders
      for (const [creatorUid, leads] of Object.entries(leadsByCreator)) {
        await this.sendWeeklyStaleLeadsEmail(parseInt(creatorUid), leads);
      }

      this.logger.log('Weekly stale leads reminder process completed successfully.');
    } catch (error) {
      this.logger.error('Failed to process weekly stale leads reminders', error.stack);
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
   * Sends a reminder email to a lead owner about their pending leads
   */
  private async sendReminderEmail(ownerUid: number, leads: Lead[]) {
    try {
      const owner = await this.userRepository.findOne({ where: { uid: ownerUid } });
      
      if (!owner || !owner.email) {
        this.logger.warn(`Owner not found or has no email: ${ownerUid}`);
        return;
      }

      // Format leads for the email template
      const formattedLeads = leads.map(lead => ({
        uid: lead.uid,
        name: lead.name || 'Unnamed Lead',
        email: lead.email,
        phone: lead.phone,
        createdAt: lead.createdAt.toLocaleDateString('en-ZA', {
          year: 'numeric', 
          month: 'short', 
          day: 'numeric'
        }),
        image: lead.image,
        latitude: lead.latitude ? Number(lead.latitude) : undefined,
        longitude: lead.longitude ? Number(lead.longitude) : undefined,
        notes: lead.notes,
      }));

      // Prepare email data
      const emailData = {
        name: owner.name || 'Team Member',
        leads: formattedLeads,
        leadsCount: leads.length,
        dashboardLink: `${process.env.DASHBOARD_URL}/leads`,
      };

      // Send email using the communication service
      await this.communicationService.sendEmail(
        EmailType.LEAD_REMINDER,
        [owner.email],
        emailData
      );

      this.logger.log(`Reminder email sent to ${owner.email} for ${leads.length} pending leads.`);
    } catch (error) {
      this.logger.error(`Failed to send reminder email to owner ${ownerUid}:`, error.stack);
    }
  }

  /**
   * Sends a weekly stale leads reminder email to a lead creator
   */
  private async sendWeeklyStaleLeadsEmail(creatorUid: number, leads: Lead[]) {
    try {
      const creator = await this.userRepository.findOne({ where: { uid: creatorUid } });
      
      if (!creator || !creator.email) {
        this.logger.warn(`Creator not found or has no email: ${creatorUid}`);
        return;
      }

      const now = new Date();

      // Format leads with additional stale lead information
      const formattedLeads = leads.map(lead => {
        const daysSinceCreated = Math.floor((now.getTime() - lead.createdAt.getTime()) / (24 * 60 * 60 * 1000));
        const daysSinceLastContact = lead.lastContactDate 
          ? Math.floor((now.getTime() - lead.lastContactDate.getTime()) / (24 * 60 * 60 * 1000))
          : 'Never contacted';

        return {
          uid: lead.uid,
          name: lead.name || 'Unnamed Lead',
          email: lead.email,
          phone: lead.phone,
          companyName: lead.companyName,
          temperature: lead.temperature,
          priority: lead.priority,
          estimatedValue: lead.estimatedValue || 0,
          daysSinceCreated,
          daysSinceLastContact,
          createdAt: lead.createdAt.toLocaleDateString('en-ZA', {
            year: 'numeric', 
            month: 'short', 
            day: 'numeric'
          }),
          lastContactDate: lead.lastContactDate?.toLocaleDateString('en-ZA', {
            year: 'numeric', 
            month: 'short', 
            day: 'numeric'
          }) || 'Never',
          image: lead.image,
          latitude: lead.latitude ? Number(lead.latitude) : undefined,
          longitude: lead.longitude ? Number(lead.longitude) : undefined,
          notes: lead.notes,
        };
      });

      // Calculate summary statistics
      const totalEstimatedValue = leads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
      const neverContactedCount = leads.filter(lead => !lead.lastContactDate).length;
      const highPriorityCount = leads.filter(lead => lead.priority === 'HIGH' || lead.priority === 'CRITICAL').length;

      // Prepare email data
      const emailData = {
        name: creator.name || 'Team Member',
        weekOf: now.toLocaleDateString('en-ZA', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        staleLeads: formattedLeads,
        totalCount: leads.length,
        totalEstimatedValue,
        neverContactedCount,
        highPriorityCount,
        dashboardUrl: `${process.env.DASHBOARD_URL}/leads`,
      };

      // Send email using the communication service
      await this.communicationService.sendEmail(
        EmailType.LEAD_REMINDER,
        [creator.email],
        emailData as any
      );

      this.logger.log(`Weekly stale leads reminder sent to ${creator.email} for ${leads.length} stale leads.`);
    } catch (error) {
      this.logger.error(`Failed to send weekly stale leads reminder to creator ${creatorUid}:`, error.stack);
    }
  }
} 