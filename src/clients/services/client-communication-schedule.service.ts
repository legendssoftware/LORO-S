import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan } from 'typeorm';
import { ClientCommunicationSchedule } from '../entities/client-communication-schedule.entity';
import { Client } from '../entities/client.entity';
import { User } from '../../user/entities/user.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { CreateCommunicationScheduleDto, UpdateCommunicationScheduleDto, CommunicationScheduleQueryDto } from '../dto/communication-schedule.dto';
import { CommunicationFrequency, CommunicationType } from '../../lib/enums/client.enums';
import { TaskType, TaskPriority, RepetitionType, TaskStatus } from '../../lib/enums/task.enums';
import { EmailType } from '../../lib/enums/email.enums';
import { PaginatedResponse } from '../../lib/interfaces/product.interfaces';
import { addDays, addWeeks, addMonths, addYears, format, startOfDay, setHours, setMinutes, startOfWeek, endOfWeek } from 'date-fns';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Cron } from '@nestjs/schedule';
import { TimezoneUtil } from '../../lib/utils/timezone.util';
import { OrganizationHoursService } from '../../attendance/services/organization.hours.service';
import { UnifiedNotificationService } from '../../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../../lib/types/unified-notification.types';

@Injectable()
export class ClientCommunicationScheduleService {
    private readonly logger = new Logger(ClientCommunicationScheduleService.name);
    private readonly CACHE_PREFIX = 'client_visits:';
    private readonly CACHE_TTL = 300000; // 5 minutes
    
    constructor(
        @InjectRepository(ClientCommunicationSchedule)
        private scheduleRepository: Repository<ClientCommunicationSchedule>,
        @InjectRepository(Client)
        private clientRepository: Repository<Client>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Task)
        private taskRepository: Repository<Task>,
        @InjectRepository(Organisation)
        private organisationRepository: Repository<Organisation>,
        private eventEmitter: EventEmitter2,
        @Inject(CACHE_MANAGER)
        private cacheManager: Cache,
        private readonly organizationHoursService: OrganizationHoursService,
        private readonly unifiedNotificationService: UnifiedNotificationService,
    ) {
        this.logger.log('ClientCommunicationScheduleService initialized with enhanced visit tracking');
    }

    /**
     * Check if user has assigned clients
     */
    private async hasAssignedClients(userId: number): Promise<boolean> {
        const user = await this.userRepository.findOne({
            where: { uid: userId, isDeleted: false },
            select: ['assignedClientIds']
        });
        return user?.assignedClientIds && user.assignedClientIds.length > 0;
    }

    /**
     * Send notification to user with no assigned clients
     */
    private async sendNoClientsNotification(user: User, operationId: string): Promise<void> {
        try {
            // Fetch user with full details for proper name construction
            const fullUser = await this.userRepository.findOne({
                where: { uid: user.uid },
                select: ['uid', 'name', 'surname', 'email', 'username'],
                relations: ['organisation', 'branch', 'branch.organisation'],
            });

            if (!fullUser) {
                this.logger.warn(`[${operationId}] User ${user.uid} not found for no-clients notification`);
                return;
            }

            // Construct full name with proper fallbacks
            const fullName = `${fullUser.name || ''} ${fullUser.surname || ''}`.trim();
            const userName = fullName || fullUser.username || 'Team Member';

            await this.unifiedNotificationService.sendTemplatedNotification(
                NotificationEvent.GENERAL_NOTIFICATION,
                [fullUser.uid],
                {
                    message: `Hi ${userName}, we would have scheduled a visit to a customer for you but we realised you do not have any assigned clients. Please contact your manager to get some clients assigned to your profile.`,
                    userName,
                    userId: fullUser.uid,
                    orgId: fullUser.organisation?.uid,
                    branchId: fullUser.branch?.uid,
                    timestamp: new Date().toISOString(),
                },
                {
                    priority: NotificationPriority.NORMAL,
                    sendEmail: false,
                    customData: {
                        screen: '/clients',
                        action: 'no_clients_assigned',
                        type: 'client_reminder',
                        context: {
                            userId: fullUser.uid,
                            reminderType: 'no_clients',
                            timestamp: new Date().toISOString()
                        }
                    }
                }
            );
            this.logger.log(`[${operationId}] No-clients notification sent to user ${fullUser.uid} (${userName})`);
        } catch (error) {
            this.logger.error(`[${operationId}] Error sending no-clients notification:`, error.message);
        }
    }

    /**
     * Create a new communication schedule for a client
     */
    async createSchedule(
        clientId: number,
        createDto: CreateCommunicationScheduleDto,
        orgId?: number,
        branchId?: number,
        createdByUserId?: number
    ): Promise<{ message: string; schedule?: ClientCommunicationSchedule }> {
        try {
            // Find the client
            const client = await this.clientRepository.findOne({
                where: { uid: clientId, isDeleted: false },
                relations: ['assignedSalesRep', 'organisation', 'branch']
            });

            if (!client) {
                throw new NotFoundException('Client not found');
            }

            // Determine who should be assigned to this communication
            let assignedUser: User = null;
            if (createDto.assignedToUserId) {
                assignedUser = await this.userRepository.findOne({
                    where: { uid: createDto.assignedToUserId }
                });
                if (!assignedUser) {
                    throw new BadRequestException('Assigned user not found');
                }
            } else if (client.assignedSalesRep) {
                assignedUser = client.assignedSalesRep;
            }

            // Validate custom frequency
            if (createDto.frequency === CommunicationFrequency.CUSTOM && !createDto.customFrequencyDays) {
                throw new BadRequestException('Custom frequency requires customFrequencyDays to be specified');
            }

            // Create the schedule
            const schedule = this.scheduleRepository.create({
                client,
                clientUid: client.uid,
                communicationType: createDto.communicationType,
                frequency: createDto.frequency,
                customFrequencyDays: createDto.customFrequencyDays,
                preferredTime: createDto.preferredTime,
                preferredDays: createDto.preferredDays,
                nextScheduledDate: createDto.nextScheduledDate ? new Date(createDto.nextScheduledDate) : null,
                isActive: createDto.isActive !== undefined ? createDto.isActive : true,
                notes: createDto.notes,
                assignedTo: assignedUser,
                assignedToUid: assignedUser?.uid,
                metadata: createDto.metadata,
                organisation: client.organisation,
                organisationUid: client.organisation?.uid,
                branch: client.branch,
                branchUid: client.branch?.uid
            });

            // Calculate next scheduled date if not provided
            if (!schedule.nextScheduledDate) {
                schedule.nextScheduledDate = this.calculateNextScheduleDate(schedule);
            }

            const savedSchedule = await this.scheduleRepository.save(schedule);

            // Create the first task for this schedule
            if (schedule.isActive && schedule.nextScheduledDate) {
                await this.createTaskFromSchedule(savedSchedule);
            }

            // Clear cache
            await this.clearScheduleCache(clientId);

            return {
                message: 'Communication schedule created successfully',
                schedule: savedSchedule
            };
        } catch (error) {
            return {
                message: error?.message || 'Failed to create communication schedule'
            };
        }
    }

    /**
     * Update an existing communication schedule
     */
    async updateSchedule(
        scheduleId: number,
        updateDto: UpdateCommunicationScheduleDto,
        orgId?: number,
        branchId?: number
    ): Promise<{ message: string; schedule?: ClientCommunicationSchedule }> {
        try {
            const schedule = await this.scheduleRepository.findOne({
                where: { uid: scheduleId, isDeleted: false },
                relations: ['client', 'assignedTo', 'organisation', 'branch']
            });

            if (!schedule) {
                throw new NotFoundException('Communication schedule not found');
            }

            // Update assigned user if provided
            if (updateDto.assignedToUserId) {
                const assignedUser = await this.userRepository.findOne({
                    where: { uid: updateDto.assignedToUserId }
                });
                if (!assignedUser) {
                    throw new BadRequestException('Assigned user not found');
                }
                schedule.assignedTo = assignedUser;
                schedule.assignedToUid = assignedUser.uid;
            }

            // Update other fields
            if (updateDto.communicationType) schedule.communicationType = updateDto.communicationType;
            if (updateDto.frequency) schedule.frequency = updateDto.frequency;
            if (updateDto.customFrequencyDays) schedule.customFrequencyDays = updateDto.customFrequencyDays;
            if (updateDto.preferredTime) schedule.preferredTime = updateDto.preferredTime;
            if (updateDto.preferredDays) schedule.preferredDays = updateDto.preferredDays;
            if (updateDto.nextScheduledDate) schedule.nextScheduledDate = new Date(updateDto.nextScheduledDate);
            if (updateDto.isActive !== undefined) schedule.isActive = updateDto.isActive;
            if (updateDto.notes) schedule.notes = updateDto.notes;
            if (updateDto.metadata) schedule.metadata = updateDto.metadata;

            // Validate custom frequency
            if (schedule.frequency === CommunicationFrequency.CUSTOM && !schedule.customFrequencyDays) {
                throw new BadRequestException('Custom frequency requires customFrequencyDays to be specified');
            }

            // Recalculate next scheduled date if frequency changed
            if (updateDto.frequency || updateDto.customFrequencyDays || updateDto.preferredDays || updateDto.preferredTime) {
                schedule.nextScheduledDate = this.calculateNextScheduleDate(schedule);
                
                // Create new task for updated schedule
                if (schedule.isActive && schedule.nextScheduledDate) {
                    await this.createTaskFromSchedule(schedule);
                }
            }

            const updatedSchedule = await this.scheduleRepository.save(schedule);

            // Clear cache
            await this.clearScheduleCache(schedule.client.uid);

            return {
                message: 'Communication schedule updated successfully',
                schedule: updatedSchedule
            };
        } catch (error) {
            return {
                message: error?.message || 'Failed to update communication schedule'
            };
        }
    }

    /**
     * Get all communication schedules for a client
     */
    async getClientSchedules(
        clientId: number,
        query: CommunicationScheduleQueryDto,
        orgId?: number,
        branchId?: number
    ): Promise<PaginatedResponse<ClientCommunicationSchedule>> {
        try {
            const { page = 1, limit = 10, communicationType, frequency, isActive, assignedToUserId } = query;

            const whereClause: any = {
                client: { uid: clientId },
                isDeleted: false
            };

            if (communicationType) whereClause.communicationType = communicationType;
            if (frequency) whereClause.frequency = frequency;
            if (isActive !== undefined) whereClause.isActive = isActive;
            if (assignedToUserId) whereClause.assignedTo = { uid: assignedToUserId };

            const [schedules, total] = await this.scheduleRepository.findAndCount({
                where: whereClause,
                relations: ['client', 'assignedTo'],
                skip: (page - 1) * limit,
                take: limit,
                order: { createdAt: 'DESC' }
            });

            return {
                data: schedules,
                meta: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                },
                message: 'Communication schedules retrieved successfully'
            };
        } catch (error) {
            return {
                data: [],
                meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
                message: error?.message || 'Failed to retrieve communication schedules'
            };
        }
    }

    /**
     * Delete a communication schedule
     */
    async deleteSchedule(scheduleId: number): Promise<{ message: string }> {
        try {
            const schedule = await this.scheduleRepository.findOne({
                where: { uid: scheduleId, isDeleted: false },
                relations: ['client']
            });

            if (!schedule) {
                throw new NotFoundException('Communication schedule not found');
            }

            // Soft delete
            schedule.isDeleted = true;
            schedule.isActive = false;
            await this.scheduleRepository.save(schedule);

            // Clear cache
            await this.clearScheduleCache(schedule.client.uid);

            return {
                message: 'Communication schedule deleted successfully'
            };
        } catch (error) {
            return {
                message: error?.message || 'Failed to delete communication schedule'
            };
        }
    }

    /**
     * Calculate the next scheduled date based on frequency and preferences
     */
    private calculateNextScheduleDate(schedule: ClientCommunicationSchedule): Date {
        const now = new Date();
        let nextDate = startOfDay(now);

        // Add time based on frequency
        switch (schedule.frequency) {
            case CommunicationFrequency.DAILY:
                nextDate = addDays(nextDate, 1);
                break;
            case CommunicationFrequency.WEEKLY:
                nextDate = addWeeks(nextDate, 1);
                break;
            case CommunicationFrequency.BIWEEKLY:
                nextDate = addWeeks(nextDate, 2);
                break;
            case CommunicationFrequency.MONTHLY:
                nextDate = addMonths(nextDate, 1);
                break;
            case CommunicationFrequency.QUARTERLY:
                nextDate = addMonths(nextDate, 3);
                break;
            case CommunicationFrequency.SEMIANNUALLY:
                nextDate = addMonths(nextDate, 6);
                break;
            case CommunicationFrequency.ANNUALLY:
                nextDate = addYears(nextDate, 1);
                break;
            case CommunicationFrequency.CUSTOM:
                if (schedule.customFrequencyDays) {
                    nextDate = addDays(nextDate, schedule.customFrequencyDays);
                }
                break;
            default:
                return null; // No scheduling for NONE
        }

        // Adjust for preferred days if specified
        if (schedule.preferredDays && schedule.preferredDays.length > 0) {
            // Find the next occurrence of one of the preferred days
            let daysToAdd = 0;
            const maxDaysToCheck = 14; // Check up to 2 weeks ahead

            while (daysToAdd < maxDaysToCheck) {
                const checkDate = addDays(nextDate, daysToAdd);
                const dayOfWeek = checkDate.getDay();
                
                if (schedule.preferredDays.includes(dayOfWeek)) {
                    nextDate = checkDate;
                    break;
                }
                daysToAdd++;
            }
        }

        // Set preferred time if specified
        if (schedule.preferredTime) {
            const [hours, minutes] = schedule.preferredTime.split(':').map(Number);
            nextDate = setHours(setMinutes(nextDate, minutes), hours);
        } else {
            // Default to 9 AM
            nextDate = setHours(nextDate, 9);
        }

        return nextDate;
    }

    /**
     * Create a task from a communication schedule
     */
    private async createTaskFromSchedule(schedule: ClientCommunicationSchedule): Promise<Task> {
        try {
            // Map communication type to task type
            const taskTypeMap = {
                [CommunicationType.PHONE_CALL]: TaskType.CALL,
                [CommunicationType.EMAIL]: TaskType.EMAIL,
                [CommunicationType.IN_PERSON_VISIT]: TaskType.VISIT,
                [CommunicationType.VIDEO_CALL]: TaskType.VIRTUAL_MEETING,
                [CommunicationType.WHATSAPP]: TaskType.WHATSAPP,
                [CommunicationType.SMS]: TaskType.SMS
            };

            const taskType = taskTypeMap[schedule.communicationType] || TaskType.FOLLOW_UP;

            // Create task title and description
            const title = `${schedule.communicationType.replace('_', ' ').toLowerCase()} with ${schedule.client.name}`;
            const description = `Scheduled ${schedule.communicationType.replace('_', ' ').toLowerCase()} communication with ${schedule.client.name}${schedule.notes ? `\n\nNotes: ${schedule.notes}` : ''}`;

            // Determine repetition type based on frequency
            const repetitionTypeMap = {
                [CommunicationFrequency.DAILY]: RepetitionType.DAILY,
                [CommunicationFrequency.WEEKLY]: RepetitionType.WEEKLY,
                [CommunicationFrequency.MONTHLY]: RepetitionType.MONTHLY,
                [CommunicationFrequency.ANNUALLY]: RepetitionType.YEARLY,
                [CommunicationFrequency.BIWEEKLY]: RepetitionType.NONE, // Handle manually
                [CommunicationFrequency.QUARTERLY]: RepetitionType.NONE, // Handle manually
                [CommunicationFrequency.SEMIANNUALLY]: RepetitionType.NONE, // Handle manually
                [CommunicationFrequency.CUSTOM]: RepetitionType.NONE, // Handle manually
                [CommunicationFrequency.NONE]: RepetitionType.NONE
            };

            const task = this.taskRepository.create({
                title,
                description,
                taskType,
                priority: TaskPriority.MEDIUM,
                deadline: schedule.nextScheduledDate,
                repetitionType: repetitionTypeMap[schedule.frequency] || RepetitionType.NONE,
                repetitionDeadline: schedule.frequency !== CommunicationFrequency.NONE ? addMonths(schedule.nextScheduledDate, 12) : null, // Set 1 year repetition deadline
                clients: [{ uid: schedule.client.uid }],
                assignees: schedule.assignedTo ? [{ uid: schedule.assignedTo.uid }] : [],
                creator: schedule.assignedTo,
                organisation: schedule.organisation,
                branch: schedule.branch,
                targetCategory: 'communication_schedule',
                status: TaskStatus.PENDING,
                progress: 0,
                isOverdue: false,
                isDeleted: false
            });

            const savedTask = await this.taskRepository.save(task);

            // Update the schedule's next date for non-repeating frequencies
            if ([CommunicationFrequency.BIWEEKLY, CommunicationFrequency.QUARTERLY, CommunicationFrequency.SEMIANNUALLY, CommunicationFrequency.CUSTOM].includes(schedule.frequency)) {
                schedule.nextScheduledDate = this.calculateNextScheduleDate(schedule);
                await this.scheduleRepository.save(schedule);
            }

            return savedTask;
        } catch (error) {
            console.error('Error creating task from schedule:', error);
            throw error;
        }
    }

    /**
     * Process all active schedules and create tasks for due communications
     */
    async processScheduledCommunications(): Promise<{ message: string; tasksCreated: number }> {
        try {
            const now = new Date();
            const schedules = await this.scheduleRepository.find({
                where: {
                    isActive: true,
                    isDeleted: false
                },
                relations: ['client', 'assignedTo', 'organisation', 'branch']
            });

            let tasksCreated = 0;

            for (const schedule of schedules) {
                // Check if it's time to create a new task
                if (schedule.nextScheduledDate && schedule.nextScheduledDate <= now) {
                    try {
                        await this.createTaskFromSchedule(schedule);
                        tasksCreated++;
                    } catch (error) {
                        console.error(`Error creating task for schedule ${schedule.uid}:`, error);
                    }
                }
            }

            return {
                message: `Processed ${schedules.length} schedules, created ${tasksCreated} tasks`,
                tasksCreated
            };
        } catch (error) {
            return {
                message: error?.message || 'Failed to process scheduled communications',
                tasksCreated: 0
            };
        }
    }

    /**
     * Get upcoming communications for a user or client
     */
    async getUpcomingCommunications(
        userId?: number,
        clientId?: number,
        days: number = 7
    ): Promise<{ schedules: ClientCommunicationSchedule[]; message: string }> {
        try {
            const endDate = addDays(new Date(), days);
            const whereClause: any = {
                isActive: true,
                isDeleted: false,
                nextScheduledDate: { $lte: endDate }
            };

            if (userId) whereClause.assignedTo = { uid: userId };
            if (clientId) whereClause.client = { uid: clientId };

            const schedules = await this.scheduleRepository.find({
                where: whereClause,
                relations: ['client', 'assignedTo'],
                order: { nextScheduledDate: 'ASC' }
            });

            return {
                schedules,
                message: 'Upcoming communications retrieved successfully'
            };
        } catch (error) {
            return {
                schedules: [],
                message: error?.message || 'Failed to retrieve upcoming communications'
            };
        }
    }

    /**
     * Clear cache for a client's schedules
     */
    private async clearScheduleCache(clientId: number): Promise<void> {
        try {
            const keys = [`client_schedules_${clientId}`, `client_${clientId}_communications`, `${this.CACHE_PREFIX}${clientId}`];
            await Promise.all(keys.map(key => this.cacheManager.del(key)));
        } catch (error) {
            console.error('Error clearing schedule cache:', error);
        }
    }

    // ======================================================
    // ENHANCED VISIT TRACKING FUNCTIONALITY
    // ======================================================

    /**
     * Get organization timezone with fallback
     */
    private async getOrganizationTimezone(organizationId?: number): Promise<string> {
        if (!organizationId) {
            const fallbackTimezone = TimezoneUtil.getSafeTimezone();
            this.logger.debug(`No organizationId provided, using fallback timezone: ${fallbackTimezone}`);
            return fallbackTimezone;
        }

        try {
            const organizationHours = await this.organizationHoursService.getOrganizationHours(organizationId);
            const timezone = organizationHours?.timezone || TimezoneUtil.getSafeTimezone();
            this.logger.debug(`Organization ${organizationId} timezone: ${timezone}`);
            return timezone;
        } catch (error) {
            this.logger.warn(`Error getting timezone for org ${organizationId}, using default:`, error);
            const fallbackTimezone = TimezoneUtil.getSafeTimezone();
            this.logger.debug(`Using fallback timezone: ${fallbackTimezone}`);
            return fallbackTimezone;
        }
    }

    /**
     * Format time in organization timezone for emails
     */
    private async formatTimeInOrganizationTimezone(date: Date, organizationId?: number): Promise<string> {
        const timezone = await this.getOrganizationTimezone(organizationId);
        return TimezoneUtil.formatInOrganizationTime(date, 'MMMM do, yyyy \'at\' h:mm a', timezone);
    }

    /**
     * Record a completed visit
     */
    async recordVisitCompletion(
        scheduleId: number,
        visitData: {
            completedDate: Date;
            duration?: string;
            notes?: string;
            outcomes?: string[];
            followUpRequired?: boolean;
            followUpDate?: Date;
            visitRating?: number;
        },
        orgId?: number,
        branchId?: number
    ): Promise<{ message: string; schedule?: ClientCommunicationSchedule }> {
        const operationId = `visit_completion_${Date.now()}`;
        this.logger.log(`[${operationId}] Recording visit completion for schedule ${scheduleId}`);

        try {
            const schedule = await this.scheduleRepository.findOne({
                where: { uid: scheduleId, isDeleted: false },
                relations: ['client', 'assignedTo', 'organisation', 'branch']
            });

            if (!schedule) {
                throw new NotFoundException('Communication schedule not found');
            }

            if (schedule.communicationType !== CommunicationType.IN_PERSON_VISIT) {
                throw new BadRequestException('This schedule is not for in-person visits');
            }

            const now = new Date();
            const completedDate = visitData.completedDate || now;

            // Update visit tracking fields
            if (!schedule.firstVisitDate) {
                schedule.firstVisitDate = completedDate;
                this.logger.debug(`[${operationId}] Recording first visit for client ${schedule.client.name}`);
            }

            schedule.lastVisitDate = completedDate;
            schedule.lastCompletedDate = completedDate;
            schedule.visitCount = (schedule.visitCount || 0) + 1;

            // Calculate next visit date
            schedule.nextScheduledDate = this.calculateNextScheduleDate(schedule);

            // Store visit metadata
            schedule.metadata = {
                ...schedule.metadata,
                lastVisitData: {
                    completedDate: completedDate.toISOString(),
                    duration: visitData.duration,
                    notes: visitData.notes,
                    outcomes: visitData.outcomes,
                    followUpRequired: visitData.followUpRequired,
                    followUpDate: visitData.followUpDate?.toISOString(),
                    visitRating: visitData.visitRating,
                    recordedAt: now.toISOString()
                }
            };

            const updatedSchedule = await this.scheduleRepository.save(schedule);

            // Clear cache
            await this.clearScheduleCache(schedule.client.uid);

            // Create next visit task if needed
            if (schedule.isActive && schedule.nextScheduledDate) {
                await this.createTaskFromSchedule(updatedSchedule);
            }

            // Send visit completion notification
            await this.sendVisitCompletionEmail(updatedSchedule, visitData, orgId);

            // Create follow-up task if required
            if (visitData.followUpRequired && visitData.followUpDate) {
                await this.createFollowUpTask(updatedSchedule, visitData, orgId, branchId);
            }

            this.logger.log(`[${operationId}] Visit completion recorded successfully for client ${schedule.client.name}`);

            return {
                message: 'Visit completion recorded successfully',
                schedule: updatedSchedule
            };
        } catch (error) {
            this.logger.error(`[${operationId}] Error recording visit completion:`, error.stack);
            return {
                message: error?.message || 'Failed to record visit completion'
            };
        }
    }

    /**
     * Send visit completion email notification
     */
    private async sendVisitCompletionEmail(
        schedule: ClientCommunicationSchedule,
        visitData: any,
        orgId?: number
    ): Promise<void> {
        try {
            if (!schedule.assignedTo?.email) {
                this.logger.warn('No email found for assigned user, skipping visit completion notification');
                return;
            }

            const organizationId = orgId || schedule.organisation?.uid;
            const completedTime = await this.formatTimeInOrganizationTimezone(new Date(visitData.completedDate), organizationId);
            const completedDate = await this.formatTimeInOrganizationTimezone(new Date(visitData.completedDate), organizationId);

            const emailData = {
                name: schedule.assignedTo.name || 'Sales Representative',
                salesRepName: schedule.assignedTo.name || 'Sales Representative',
                salesRepEmail: schedule.assignedTo.email,
                client: {
                    uid: schedule.client.uid,
                    name: schedule.client.name,
                    email: schedule.client.email,
                    phone: schedule.client.phone,
                    company: schedule.client.name,
                    contactPerson: schedule.client.contactPerson
                },
                visit: {
                    completedDate,
                    completedTime,
                    duration: visitData.duration,
                    notes: visitData.notes,
                    outcomes: visitData.outcomes,
                    followUpRequired: visitData.followUpRequired,
                    followUpDate: visitData.followUpDate ? await this.formatTimeInOrganizationTimezone(new Date(visitData.followUpDate), organizationId) : undefined,
                    visitRating: visitData.visitRating,
                    totalVisits: schedule.visitCount
                },
                schedule: {
                    uid: schedule.uid,
                    nextVisitDate: schedule.nextScheduledDate ? await this.formatTimeInOrganizationTimezone(schedule.nextScheduledDate, organizationId) : undefined,
                    frequency: schedule.frequency
                },
                organization: {
                    name: schedule.organisation?.name || 'Your Organization',
                    uid: organizationId || 0
                },
                branch: schedule.branch ? {
                    name: schedule.branch.name,
                    uid: schedule.branch.uid
                } : undefined,
                dashboardLink: process.env.WEB_URL || 'https://app.loro.co.za',
                clientDetailsLink: `${process.env.WEB_URL || 'https://app.loro.co.za'}/clients/${schedule.client.uid}`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.co.za',
                congratulationsMessage: `Excellent work! You've successfully completed your visit with ${schedule.client.name}. This was visit #${schedule.visitCount} with this client.`
            };

            this.eventEmitter.emit('send.email', EmailType.CLIENT_VISIT_COMPLETED, [schedule.assignedTo.email], emailData);
            this.logger.log(`Visit completion email queued for ${schedule.assignedTo.email}`);
        } catch (error) {
            this.logger.error('Error sending visit completion email:', error.message);
        }
    }

    /**
     * Create follow-up task
     */
    private async createFollowUpTask(
        schedule: ClientCommunicationSchedule,
        visitData: any,
        orgId?: number,
        branchId?: number
    ): Promise<void> {
        try {
            const followUpTask = this.taskRepository.create({
                title: `Follow-up: ${schedule.client.name} Visit`,
                description: `Follow-up required from visit on ${format(new Date(visitData.completedDate), 'PPP')}.\n\nVisit Notes: ${visitData.notes || 'No notes provided'}\n\nOutcomes: ${visitData.outcomes?.join(', ') || 'None specified'}`,
                taskType: TaskType.FOLLOW_UP,
                priority: TaskPriority.MEDIUM,
                deadline: visitData.followUpDate,
                clients: [{ uid: schedule.client.uid }],
                assignees: schedule.assignedTo ? [{ uid: schedule.assignedTo.uid }] : [],
                creator: schedule.assignedTo,
                organisation: schedule.organisation,
                branch: schedule.branch,
                targetCategory: 'visit_follow_up',
                status: TaskStatus.PENDING,
                progress: 0,
                isOverdue: false,
                isDeleted: false
            });

            await this.taskRepository.save(followUpTask);
            this.logger.log(`Follow-up task created for visit with ${schedule.client.name}`);
        } catch (error) {
            this.logger.error('Error creating follow-up task:', error.message);
        }
    }

    /**
     * Check for overdue visits and send notifications
     */
    @Cron('0 9 * * *') // Run daily at 9 AM
    async checkOverdueVisits(): Promise<void> {
        const operationId = `overdue_check_${Date.now()}`;
        this.logger.log(`[${operationId}] Starting overdue visit check`);

        try {
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            // Find overdue in-person visit schedules
            const overdueSchedules = await this.scheduleRepository.find({
                where: {
                    communicationType: CommunicationType.IN_PERSON_VISIT,
                    isActive: true,
                    isDeleted: false,
                    nextScheduledDate: LessThan(yesterday)
                },
                relations: ['client', 'assignedTo', 'organisation', 'branch']
            });

            this.logger.log(`[${operationId}] Found ${overdueSchedules.length} overdue visits`);

            for (const schedule of overdueSchedules) {
                try {
                    await this.sendOverdueVisitNotification(schedule, operationId);
                } catch (error) {
                    this.logger.error(`[${operationId}] Error sending overdue notification for schedule ${schedule.uid}:`, error.message);
                }
            }

            this.logger.log(`[${operationId}] Overdue visit check completed`);
        } catch (error) {
            this.logger.error(`[${operationId}] Error in overdue visit check:`, error.stack);
        }
    }

    /**
     * Send overdue visit notification
     */
    private async sendOverdueVisitNotification(schedule: ClientCommunicationSchedule, operationId: string): Promise<void> {
        try {
            if (!schedule.assignedTo?.email) {
                this.logger.warn(`[${operationId}] No email found for schedule ${schedule.uid}, skipping notification`);
                return;
            }

            // Check if user has assigned clients
            const hasClients = await this.hasAssignedClients(schedule.assignedTo.uid);
            if (!hasClients) {
                this.logger.log(`[${operationId}] User ${schedule.assignedTo.uid} has no assigned clients, sending alternative notification`);
                await this.sendNoClientsNotification(schedule.assignedTo, operationId);
                return;
            }

            const now = new Date();
            const organizationId = schedule.organisation?.uid;
            const daysOverdue = Math.floor((now.getTime() - schedule.nextScheduledDate.getTime()) / (24 * 60 * 60 * 1000));

            const originalScheduledDate = await this.formatTimeInOrganizationTimezone(schedule.nextScheduledDate, organizationId);
            const lastVisitDate = schedule.lastVisitDate ? await this.formatTimeInOrganizationTimezone(schedule.lastVisitDate, organizationId) : undefined;
            const daysSinceLastVisit = schedule.lastVisitDate ? Math.floor((now.getTime() - schedule.lastVisitDate.getTime()) / (24 * 60 * 60 * 1000)) : undefined;

            // Determine urgency level
            let urgencyLevel = 'normal';
            let priority = 'medium';
            if (daysOverdue > 14) {
                urgencyLevel = 'critical';
                priority = 'high';
            } else if (daysOverdue > 7) {
                urgencyLevel = 'urgent';
                priority = 'high';
            }

            const emailData = {
                name: schedule.assignedTo.name || 'Sales Representative',
                salesRepName: schedule.assignedTo.name || 'Sales Representative',
                salesRepEmail: schedule.assignedTo.email,
                client: {
                    uid: schedule.client.uid,
                    name: schedule.client.name,
                    email: schedule.client.email,
                    phone: schedule.client.phone,
                    company: schedule.client.name,
                    contactPerson: schedule.client.contactPerson
                },
                visit: {
                    type: schedule.communicationType,
                    originalScheduledDate,
                    originalScheduledTime: schedule.preferredTime,
                    daysOverdue,
                    frequency: schedule.frequency,
                    lastVisitDate,
                    daysSinceLastVisit
                },
                schedule: {
                    uid: schedule.uid,
                    priority,
                    urgencyLevel
                },
                organization: {
                    name: schedule.organisation?.name || 'Your Organization',
                    uid: organizationId || 0
                },
                branch: schedule.branch ? {
                    name: schedule.branch.name,
                    uid: schedule.branch.uid
                } : undefined,
                dashboardLink: process.env.WEB_URL || 'https://app.loro.co.za',
                clientDetailsLink: `${process.env.WEB_URL || 'https://app.loro.co.za'}/clients/${schedule.client.uid}`,
                rescheduleLink: `${process.env.WEB_URL || 'https://app.loro.co.za'}/clients/${schedule.client.uid}/schedule`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.co.za',
                escalationMessage: `Your visit with ${schedule.client.name} is ${daysOverdue} days overdue. Please take immediate action to reschedule and maintain this important client relationship.`
            };

            // Send email notification
            this.eventEmitter.emit('send.email', EmailType.CLIENT_VISIT_OVERDUE, [schedule.assignedTo.email], emailData);

            // Send push notification
            await this.unifiedNotificationService.sendTemplatedNotification(
                NotificationEvent.ATTENDANCE_MISSED_SHIFT_ALERT, // Reusing existing event type
                [schedule.assignedTo.uid],
                {
                    message: `🚨 Overdue Visit: Your visit with ${schedule.client.name} is ${daysOverdue} days overdue. Please reschedule immediately.`,
                    clientName: schedule.client.name,
                    daysOverdue,
                    urgencyLevel,
                    userId: schedule.assignedTo.uid,
                    timestamp: new Date().toISOString()
                },
                {
                    priority: urgencyLevel === 'critical' ? NotificationPriority.HIGH : NotificationPriority.NORMAL
                }
            );

            this.logger.log(`[${operationId}] Overdue visit notification sent for ${schedule.client.name} (${daysOverdue} days)`);
        } catch (error) {
            this.logger.error(`[${operationId}] Error sending overdue visit notification:`, error.message);
        }
    }

    /**
     * Send visit reminders (day before scheduled visit)
     */
    @Cron('0 17 * * *') // Run daily at 5 PM
    async sendVisitReminders(): Promise<void> {
        const operationId = `visit_reminders_${Date.now()}`;
        this.logger.log(`[${operationId}] Starting visit reminder check`);

        try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const startOfTomorrow = startOfDay(tomorrow);
            const endOfTomorrow = new Date(startOfTomorrow);
            endOfTomorrow.setHours(23, 59, 59, 999);

            // Find visits scheduled for tomorrow
            const upcomingVisits = await this.scheduleRepository.find({
                where: {
                    communicationType: CommunicationType.IN_PERSON_VISIT,
                    isActive: true,
                    isDeleted: false,
                    nextScheduledDate: Between(startOfTomorrow, endOfTomorrow)
                },
                relations: ['client', 'assignedTo', 'organisation', 'branch']
            });

            this.logger.log(`[${operationId}] Found ${upcomingVisits.length} visits scheduled for tomorrow`);

            for (const schedule of upcomingVisits) {
                try {
                    await this.sendVisitReminderNotification(schedule, operationId);
                } catch (error) {
                    this.logger.error(`[${operationId}] Error sending reminder for schedule ${schedule.uid}:`, error.message);
                }
            }

            this.logger.log(`[${operationId}] Visit reminder check completed`);
        } catch (error) {
            this.logger.error(`[${operationId}] Error in visit reminder check:`, error.stack);
        }
    }

    /**
     * Send visit reminder notification
     */
    private async sendVisitReminderNotification(schedule: ClientCommunicationSchedule, operationId: string): Promise<void> {
        try {
            if (!schedule.assignedTo?.email) {
                this.logger.warn(`[${operationId}] No email found for schedule ${schedule.uid}, skipping reminder`);
                return;
            }

            // Check if user has assigned clients
            const hasClients = await this.hasAssignedClients(schedule.assignedTo.uid);
            if (!hasClients) {
                this.logger.log(`[${operationId}] User ${schedule.assignedTo.uid} has no assigned clients, sending alternative notification`);
                await this.sendNoClientsNotification(schedule.assignedTo, operationId);
                return;
            }

            const organizationId = schedule.organisation?.uid;
            const scheduledDate = await this.formatTimeInOrganizationTimezone(schedule.nextScheduledDate, organizationId);
            const lastVisitDate = schedule.lastVisitDate ? await this.formatTimeInOrganizationTimezone(schedule.lastVisitDate, organizationId) : undefined;
            const daysSinceLastVisit = schedule.lastVisitDate ? Math.floor((Date.now() - schedule.lastVisitDate.getTime()) / (24 * 60 * 60 * 1000)) : undefined;

            const emailData = {
                name: schedule.assignedTo.name || 'Sales Representative',
                salesRepName: schedule.assignedTo.name || 'Sales Representative',
                salesRepEmail: schedule.assignedTo.email,
                client: {
                    uid: schedule.client.uid,
                    name: schedule.client.name,
                    email: schedule.client.email,
                    phone: schedule.client.phone,
                    company: schedule.client.name,
                    contactPerson: schedule.client.contactPerson,
                    address: schedule.client.address,
                    latitude: schedule.client.latitude,
                    longitude: schedule.client.longitude
                },
                visit: {
                    type: schedule.communicationType,
                    scheduledDate,
                    scheduledTime: schedule.preferredTime,
                    frequency: schedule.frequency,
                    notes: schedule.notes,
                    lastVisitDate,
                    daysSinceLastVisit,
                    totalVisits: schedule.visitCount || 0,
                    visitPurpose: schedule.metadata?.visitPurpose,
                    estimatedDuration: schedule.metadata?.estimatedDuration
                },
                schedule: {
                    uid: schedule.uid,
                    isOverdue: false,
                    daysOverdue: 0,
                    priority: 'medium',
                    urgencyLevel: 'normal'
                },
                organization: {
                    name: schedule.organisation?.name || 'Your Organization',
                    uid: organizationId || 0
                },
                branch: schedule.branch ? {
                    name: schedule.branch.name,
                    uid: schedule.branch.uid
                } : undefined,
                dashboardLink: process.env.WEB_URL || 'https://app.loro.co.za',
                clientDetailsLink: `${process.env.WEB_URL || 'https://app.loro.co.za'}/clients/${schedule.client.uid}`,
                tasksLink: `${process.env.WEB_URL || 'https://app.loro.co.za'}/tasks`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.co.za',
                reminderDate: format(new Date(), 'PPP'),
                visitPreparationTips: [
                    'Review previous visit notes and client history',
                    'Prepare any materials or samples needed',
                    'Confirm the appointment with the client',
                    'Check traffic conditions and plan your route'
                ],
                nextSteps: [
                    'Arrive on time and prepared',
                    'Focus on building the relationship',
                    'Listen to client needs and concerns',
                    'Document visit outcomes thoroughly'
                ],
                directionsLink: schedule.client.latitude && schedule.client.longitude 
                    ? `https://maps.google.com/?q=${schedule.client.latitude},${schedule.client.longitude}`
                    : undefined
            };

            // Send email notification
            this.eventEmitter.emit('send.email', EmailType.CLIENT_VISIT_REMINDER, [schedule.assignedTo.email], emailData);

            // Send push notification
            await this.unifiedNotificationService.sendTemplatedNotification(
                NotificationEvent.ATTENDANCE_SHIFT_START_REMINDER, // Reusing existing event type
                [schedule.assignedTo.uid],
                {
                    message: `📅 Visit Reminder: You have a visit scheduled with ${schedule.client.name} tomorrow at ${schedule.preferredTime || 'TBD'}.`,
                    clientName: schedule.client.name,
                    scheduledDate,
                    scheduledTime: schedule.preferredTime,
                    userId: schedule.assignedTo.uid,
                    timestamp: new Date().toISOString()
                },
                {
                    priority: NotificationPriority.NORMAL
                }
            );

            this.logger.log(`[${operationId}] Visit reminder sent for ${schedule.client.name}`);
        } catch (error) {
            this.logger.error(`[${operationId}] Error sending visit reminder:`, error.message);
        }
    }

    /**
     * Generate and send weekly visit reports
     */
    @Cron('0 8 * * 1') // Run every Monday at 8 AM
    async sendWeeklyVisitReports(): Promise<void> {
        const operationId = `weekly_reports_${Date.now()}`;
        this.logger.log(`[${operationId}] Starting weekly visit report generation`);

        try {
            // Get all sales reps with active visit schedules
            const salesReps = await this.userRepository
                .createQueryBuilder('user')
                .innerJoin('user.clientCommunicationSchedules', 'schedule')
                .where('schedule.communicationType = :type', { type: CommunicationType.IN_PERSON_VISIT })
                .andWhere('schedule.isActive = :active', { active: true })
                .andWhere('schedule.isDeleted = :deleted', { deleted: false })
                .andWhere('user.isDeleted = :userDeleted', { userDeleted: false })
                .select(['user.uid', 'user.name', 'user.surname', 'user.email'])
                .distinct(true)
                .getMany();

            this.logger.log(`[${operationId}] Found ${salesReps.length} sales reps to send reports to`);

            for (const salesRep of salesReps) {
                try {
                    await this.generateAndSendWeeklyReport(salesRep, operationId);
                } catch (error) {
                    this.logger.error(`[${operationId}] Error generating report for ${salesRep.email}:`, error.message);
                }
            }

            this.logger.log(`[${operationId}] Weekly visit report generation completed`);
        } catch (error) {
            this.logger.error(`[${operationId}] Error in weekly visit report generation:`, error.stack);
        }
    }

    /**
     * Generate and send weekly report for a specific sales rep
     */
    private async generateAndSendWeeklyReport(salesRep: User, operationId: string): Promise<void> {
        try {
            if (!salesRep.email) {
                this.logger.warn(`[${operationId}] No email found for user ${salesRep.uid}, skipping report`);
                return;
            }

            // Check if user has assigned clients
            const hasClients = await this.hasAssignedClients(salesRep.uid);
            if (!hasClients) {
                this.logger.log(`[${operationId}] User ${salesRep.uid} has no assigned clients, sending alternative notification`);
                await this.sendNoClientsNotification(salesRep, operationId);
                return;
            }

            const now = new Date();
            const startOfLastWeek = startOfWeek(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), { weekStartsOn: 1 }); // Monday
            const endOfLastWeek = endOfWeek(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), { weekStartsOn: 1 }); // Sunday

            // Get all visit schedules for this sales rep
            const visitSchedules = await this.scheduleRepository.find({
                where: {
                    assignedTo: { uid: salesRep.uid },
                    communicationType: CommunicationType.IN_PERSON_VISIT,
                    isDeleted: false
                },
                relations: ['client', 'organisation', 'branch']
            });

            // Calculate report data
            const reportData = await this.calculateWeeklyReportData(visitSchedules, startOfLastWeek, endOfLastWeek, salesRep);

            // Send the report email
            this.eventEmitter.emit('send.email', EmailType.CLIENT_VISIT_WEEKLY_REPORT, [salesRep.email], reportData);

            this.logger.log(`[${operationId}] Weekly report sent to ${salesRep.email}`);
        } catch (error) {
            this.logger.error(`[${operationId}] Error generating weekly report for ${salesRep.email}:`, error.message);
        }
    }

    /**
     * Calculate weekly report data
     */
    private async calculateWeeklyReportData(
        schedules: ClientCommunicationSchedule[],
        startDate: Date,
        endDate: Date,
        salesRep: User
    ): Promise<any> {
        const now = new Date();
        
        // Get organization timezone (use first schedule's org)
        const organizationId = schedules[0]?.organisation?.uid;
        const timezone = await this.getOrganizationTimezone(organizationId);

        // Convert dates to organization timezone
        const startDateFormatted = TimezoneUtil.formatInOrganizationTime(startDate, 'PPP', timezone);
        const endDateFormatted = TimezoneUtil.formatInOrganizationTime(endDate, 'PPP', timezone);

        // Filter schedules for completed visits in the week
        const completedVisits = schedules.filter(schedule => 
            schedule.lastVisitDate && 
            schedule.lastVisitDate >= startDate && 
            schedule.lastVisitDate <= endDate
        );

        // Filter schedules for visits scheduled in the week
        const scheduledVisits = schedules.filter(schedule =>
            schedule.nextScheduledDate &&
            schedule.nextScheduledDate >= startDate &&
            schedule.nextScheduledDate <= endDate
        );

        // Find overdue visits
        const overdueVisits = schedules.filter(schedule =>
            schedule.nextScheduledDate &&
            schedule.nextScheduledDate < now &&
            schedule.isActive
        );

        // Find upcoming visits (next 7 days)
        const nextWeekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const upcomingVisits = schedules.filter(schedule =>
            schedule.nextScheduledDate &&
            schedule.nextScheduledDate > now &&
            schedule.nextScheduledDate <= nextWeekEnd &&
            schedule.isActive
        );

        // Calculate completion rate
        const totalScheduled = scheduledVisits.length;
        const totalCompleted = completedVisits.length;
        const completionRate = totalScheduled > 0 ? Math.round((totalCompleted / totalScheduled) * 100) : 0;

        // Get unique clients visited
        const uniqueClientsVisited = new Set(completedVisits.map(v => v.client.uid)).size;

        // Prepare report data
        return {
            name: salesRep.name || 'Sales Representative',
            salesRepName: `${salesRep.name || ''} ${salesRep.surname || ''}`.trim(),
            salesRepEmail: salesRep.email,
            reportPeriod: {
                startDate: startDateFormatted,
                endDate: endDateFormatted,
                weekNumber: Math.ceil(((startDate.getTime() - new Date(startDate.getFullYear(), 0, 1).getTime()) / 86400000 + new Date(startDate.getFullYear(), 0, 1).getDay() + 1) / 7),
                year: startDate.getFullYear()
            },
            summary: {
                totalVisitsCompleted: totalCompleted,
                totalVisitsScheduled: totalScheduled,
                completionRate,
                totalClientsVisited: uniqueClientsVisited,
                overdueVisits: overdueVisits.length,
                upcomingVisits: upcomingVisits.length,
                averageVisitDuration: '1-2 hours', // This could be calculated from visit data
                totalTravelTime: undefined,
                totalVisitTime: undefined
            },
            completedVisits: completedVisits.map(schedule => ({
                clientName: schedule.client.name,
                clientUid: schedule.client.uid,
                visitDate: TimezoneUtil.formatInOrganizationTime(schedule.lastVisitDate, 'PPP', timezone),
                visitTime: TimezoneUtil.formatInOrganizationTime(schedule.lastVisitDate, 'p', timezone),
                duration: schedule.metadata?.lastVisitData?.duration,
                notes: schedule.metadata?.lastVisitData?.notes,
                outcomes: schedule.metadata?.lastVisitData?.outcomes,
                followUpRequired: schedule.metadata?.lastVisitData?.followUpRequired,
                rating: schedule.metadata?.lastVisitData?.visitRating
            })),
            upcomingVisits: upcomingVisits.map(schedule => ({
                clientName: schedule.client.name,
                clientUid: schedule.client.uid,
                scheduledDate: TimezoneUtil.formatInOrganizationTime(schedule.nextScheduledDate, 'PPP', timezone),
                scheduledTime: schedule.preferredTime,
                visitType: schedule.communicationType,
                notes: schedule.notes,
                isOverdue: false,
                daysOverdue: 0
            })),
            missedVisits: overdueVisits.map(schedule => ({
                clientName: schedule.client.name,
                clientUid: schedule.client.uid,
                originalDate: TimezoneUtil.formatInOrganizationTime(schedule.nextScheduledDate, 'PPP', timezone),
                daysMissed: Math.floor((now.getTime() - schedule.nextScheduledDate.getTime()) / (24 * 60 * 60 * 1000)),
                frequency: schedule.frequency,
                lastVisitDate: schedule.lastVisitDate ? TimezoneUtil.formatInOrganizationTime(schedule.lastVisitDate, 'PPP', timezone) : undefined
            })),
            clientInsights: schedules.map(schedule => ({
                clientName: schedule.client.name,
                clientUid: schedule.client.uid,
                totalVisits: schedule.visitCount || 0,
                lastVisitDate: schedule.lastVisitDate ? TimezoneUtil.formatInOrganizationTime(schedule.lastVisitDate, 'PPP', timezone) : undefined,
                nextVisitDate: schedule.nextScheduledDate ? TimezoneUtil.formatInOrganizationTime(schedule.nextScheduledDate, 'PPP', timezone) : undefined,
                visitFrequency: schedule.frequency,
                trend: 'stable', // This could be calculated based on visit history
                notes: schedule.notes
            })),
            performance: {
                punctualityRate: 85, // This could be calculated from actual data
                clientSatisfactionAverage: undefined,
                visitGoalsAchieved: totalCompleted,
                visitGoalsTotal: totalScheduled,
                improvementAreas: completionRate < 80 ? ['Improve visit scheduling and completion rate'] : undefined,
                strengths: completionRate >= 80 ? ['Strong client visit completion rate'] : undefined
            },
            organization: {
                name: schedules[0]?.organisation?.name || 'Your Organization',
                uid: organizationId || 0
            },
            branch: schedules[0]?.branch ? {
                name: schedules[0].branch.name,
                uid: schedules[0].branch.uid
            } : undefined,
            dashboardLink: process.env.WEB_URL || 'https://app.loro.co.za',
            detailedReportLink: `${process.env.WEB_URL || 'https://app.loro.co.za'}/reports/visits`,
            supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.co.za',
            managerName: undefined,
            managerEmail: undefined,
            nextWeekGoals: [
                'Maintain high visit completion rate',
                'Follow up on all completed visits',
                'Address any overdue visits promptly'
            ]
        };
    }
} 