import { Between, Repository, In, MoreThan } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Lead } from './entities/lead.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { AccessLevel } from '../lib/enums/user.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { endOfDay } from 'date-fns';
import { startOfDay } from 'date-fns';
import { NotificationStatus, NotificationType } from '../lib/enums/notification.enums';
import { LeadStatus, LeadTemperature, LeadLifecycleStage, LeadPriority } from '../lib/enums/lead.enums';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES } from '../lib/constants/constants';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { PaginatedResponse } from 'src/lib/types/paginated-response';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { CommunicationService } from '../communication/communication.service';
import { ConfigService } from '@nestjs/config';
import { EmailType } from '../lib/enums/email.enums';
import { LeadStatusHistoryEntry } from './entities/lead.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { LeadScoringService } from './lead-scoring.service';
import { Cron } from '@nestjs/schedule';
import { Interaction } from '../interactions/entities/interaction.entity';
import { AccountStatus } from '../lib/enums/status.enums';
import { Task } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { TaskType, TaskPriority } from '../lib/enums/task.enums';

@Injectable()
export class LeadsService {
	private readonly logger = new Logger(LeadsService.name);

	// Define inactive user statuses that should not receive notifications
	private readonly INACTIVE_USER_STATUSES = [
		AccountStatus.INACTIVE,
		AccountStatus.DELETED,
		AccountStatus.BANNED,
		AccountStatus.DECLINED,
	];

	constructor(
		@InjectRepository(Lead)
		private leadsRepository: Repository<Lead>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Interaction)
		private interactionRepository: Repository<Interaction>,
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		private readonly eventEmitter: EventEmitter2,
		private readonly rewardsService: RewardsService,
		private readonly communicationService: CommunicationService,
		private readonly configService: ConfigService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly leadScoringService: LeadScoringService,
		private readonly tasksService: TasksService,
	) {}

	async create(
		createLeadDto: CreateLeadDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; data: Lead | null }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Create the lead entity
			const lead = this.leadsRepository.create(createLeadDto as unknown as Lead);

			// Set organization
			if (orgId) {
				const organisation = { uid: orgId } as Organisation;
				lead.organisation = organisation;
			}

			// Set branch if provided
			if (branchId) {
				const branch = { uid: branchId } as Branch;
				lead.branch = branch;
			}

			// Handle assignees if provided
			if (createLeadDto.assignees?.length) {
				lead.assignees = createLeadDto.assignees.map((assignee) => ({ uid: assignee.uid }));
			} else {
				lead.assignees = [];
			}

			// Set intelligent defaults for new leads
			await this.setIntelligentDefaults(lead);

			const savedLead = await this.leadsRepository.save(lead);

			// Populate the lead with full relation data
			const populatedLead = await this.populateLeadRelations(savedLead);

			// EVENT-DRIVEN AUTOMATION: Post-creation actions
			await this.handleLeadCreatedEvents(populatedLead);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				data: populatedLead,
			};

			return response;
		} catch (error) {
			this.logger.error(`Error creating lead: ${error.message}`, error.stack);
			const response = {
				message: error?.message,
				data: null,
			};

			return response;
		}
	}

	async findAll(
		filters?: {
			status?: LeadStatus;
			search?: string;
			startDate?: Date;
			endDate?: Date;
			temperature?: LeadTemperature;
			minScore?: number;
			maxScore?: number;
		},
		page: number = 1,
		limit: number = 25,
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Lead>> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const queryBuilder = this.leadsRepository
				.createQueryBuilder('lead')
				.leftJoinAndSelect('lead.owner', 'owner')
				.leftJoinAndSelect('lead.branch', 'branch')
				.leftJoinAndSelect('lead.organisation', 'organisation')
				.where('lead.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('organisation.uid = :orgId', { orgId });

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			if (filters?.status) {
				queryBuilder.andWhere('lead.status = :status', { status: filters.status });
			}

			if (filters?.temperature) {
				queryBuilder.andWhere('lead.temperature = :temperature', { temperature: filters.temperature });
			}

			if (filters?.minScore !== undefined) {
				queryBuilder.andWhere('lead.leadScore >= :minScore', { minScore: filters.minScore });
			}

			if (filters?.maxScore !== undefined) {
				queryBuilder.andWhere('lead.leadScore <= :maxScore', { maxScore: filters.maxScore });
			}

			if (filters?.startDate && filters?.endDate) {
				queryBuilder.andWhere('lead.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
			}

			if (filters?.search) {
				queryBuilder.andWhere(
					'(lead.name ILIKE :search OR lead.email ILIKE :search OR lead.phone ILIKE :search OR lead.companyName ILIKE :search OR owner.name ILIKE :search OR owner.surname ILIKE :search)',
					{ search: `%${filters.search}%` },
				);
			}

			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('lead.leadScore', 'DESC') // Order by lead score (highest priority first)
				.addOrderBy('lead.createdAt', 'DESC');

			const [leads, total] = await queryBuilder.getManyAndCount();

			if (!leads) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Populate leads with full assignee details
			const populatedLeads = await Promise.all(leads.map((lead) => this.populateLeadRelations(lead)));

			const stats = this.calculateStats(leads);

			return {
				data: populatedLeads,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	async findOne(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ lead: Lead | null; message: string; stats: any }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const lead = await this.leadsRepository.findOne({
				where: whereClause,
				relations: ['owner', 'organisation', 'branch', 'interactions'],
			});

			if (!lead) {
				return {
					lead: null,
					message: process.env.NOT_FOUND_MESSAGE,
					stats: null,
				};
			}

			// Populate the lead with full assignee details
			const populatedLead = await this.populateLeadRelations(lead);

			// Update activity data when lead is viewed
			await this.leadScoringService.updateActivityData(ref);

			const allLeads = await this.leadsRepository.find({
				where: {
					isDeleted: false,
					organisation: { uid: orgId },
				},
			});
			const stats = this.calculateStats(allLeads);

			const response = {
				lead: populatedLead,
				message: process.env.SUCCESS_MESSAGE,
				stats,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				lead: null,
				stats: null,
			};

			return response;
		}
	}

	public async leadsByUser(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; leads: Lead[]; stats: any }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				owner: { uid: ref },
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const leads = await this.leadsRepository.find({
				where: whereClause,
				relations: ['owner', 'organisation', 'branch'],
				order: { leadScore: 'DESC', updatedAt: 'DESC' }, // Order by score and recency
			});

			if (!leads) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Populate all leads with full assignee details
			const populatedLeads = await Promise.all(leads.map((lead) => this.populateLeadRelations(lead)));

			const stats = this.calculateStats(leads);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				leads: populatedLeads,
				stats,
			};

			return response;
		} catch (error) {
			const response = {
				message: `could not get leads by user - ${error?.message}`,
				leads: null,
				stats: null,
			};

			return response;
		}
	}

	async update(
		ref: number,
		updateLeadDto: UpdateLeadDto,
		orgId?: number,
		branchId?: number,
		userId?: number, // Optionally pass userId performing the update
	): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const lead = await this.leadsRepository.findOne({
				where: { uid: ref, organisation: { uid: orgId }, branch: { uid: branchId } },
				relations: ['owner', 'organisation', 'branch', 'interactions'],
			});

			if (!lead) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const oldStatus = lead.status;
			const oldTemperature = lead.temperature;
			const oldPriority = lead.priority;

			// Ensure changeHistory is treated as an array of LeadStatusHistoryEntry
			const changeHistoryArray: LeadStatusHistoryEntry[] = Array.isArray(lead.changeHistory)
				? lead.changeHistory
				: [];
			const dataToSave: Partial<Lead> = {};

			// Build the data to save, excluding reason/description from UpdateLeadDto that are specific to status change
			for (const key in updateLeadDto) {
				if (key !== 'statusChangeReason' && key !== 'statusChangeDescription' && key !== 'nextStep') {
					dataToSave[key] = updateLeadDto[key];
				}
			}

			// If status is being updated, add a history entry
			if (updateLeadDto.status && updateLeadDto.status !== oldStatus) {
				const newHistoryEntry: LeadStatusHistoryEntry = {
					timestamp: new Date(),
					oldStatus: oldStatus,
					newStatus: updateLeadDto.status,
					reason: updateLeadDto.statusChangeReason,
					description: updateLeadDto.statusChangeDescription,
					nextStep: updateLeadDto.nextStep,
					userId: userId, // User who made the change
				};

				changeHistoryArray.push(newHistoryEntry);
				dataToSave.changeHistory = changeHistoryArray;
			}

			// Handle assignees update specifically
			if (updateLeadDto.assignees) {
				dataToSave.assignees = updateLeadDto.assignees.map((a) => ({ uid: a.uid }));
			} else if (updateLeadDto.hasOwnProperty('assignees')) {
				// If assignees key exists but is empty/null, clear it
				dataToSave.assignees = [];
			}

			// Apply intelligent updates based on data changes
			await this.applyIntelligentUpdates(lead, dataToSave);

			await this.leadsRepository.update(ref, dataToSave);

			// EVENT-DRIVEN AUTOMATION: Post-update actions
			const updatedLead = await this.leadsRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'organisation', 'branch', 'interactions'],
			});

			if (updatedLead) {
				await this.handleLeadUpdatedEvents(updatedLead, {
					statusChanged: oldStatus !== updateLeadDto.status,
					temperatureChanged: oldTemperature !== updateLeadDto.temperature,
					priorityChanged: oldPriority !== updateLeadDto.priority,
					assigneesChanged: !!updateLeadDto.assignees,
				});
			}

			return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			this.logger.error(`Error updating lead ${ref}: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const lead = await this.leadsRepository.findOne({
				where: whereClause,
			});

			if (!lead) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			// Use soft delete by updating isDeleted flag
			await this.leadsRepository.update(ref, { isDeleted: true });

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	async restore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: true,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const lead = await this.leadsRepository.findOne({
				where: whereClause,
			});

			if (!lead) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			// Restore by setting isDeleted to false
			await this.leadsRepository.update(ref, { isDeleted: false });

			// Recalculate score for restored lead
			await this.leadScoringService.calculateLeadScore(ref);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	async reactivate(ref: number, orgId?: number, branchId?: number, userId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const lead = await this.leadsRepository.findOne({
				where: whereClause,
				relations: ['owner', 'organisation', 'branch'],
			});

			if (!lead) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			// Check if lead can be reactivated (only declined or cancelled leads)
			if (lead.status !== LeadStatus.DECLINED && lead.status !== LeadStatus.CANCELLED) {
				return {
					message: 'Only declined or cancelled leads can be reactivated',
				};
			}

			const oldStatus = lead.status;
			const newStatus = LeadStatus.PENDING;

			// Ensure changeHistory is treated as an array of LeadStatusHistoryEntry
			const changeHistoryArray: LeadStatusHistoryEntry[] = Array.isArray(lead.changeHistory)
				? lead.changeHistory
				: [];

			// Add reactivation entry to history
			const newHistoryEntry: LeadStatusHistoryEntry = {
				timestamp: new Date(),
				oldStatus: oldStatus,
				newStatus: newStatus,
				reason: 'Lead reactivated',
				description: 'Lead status changed from ' + oldStatus + ' to ' + newStatus + ' via reactivation',
				nextStep: 'Review and follow up with lead',
				userId: userId,
			};

			changeHistoryArray.push(newHistoryEntry);

			// Update lead status and add history
			await this.leadsRepository.update(ref, {
				status: newStatus,
				changeHistory: changeHistoryArray,
				temperature: LeadTemperature.COLD, // Reset temperature to cold for reactivated leads
				priority: LeadPriority.MEDIUM, // Reset priority to medium
			});

			// Recalculate lead score
			await this.leadScoringService.calculateLeadScore(ref);
			await this.leadScoringService.updateActivityData(ref);

			// Send notification about reactivation
			const updatedLead = await this.leadsRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'assignees'],
			});

			if (updatedLead) {
				const userIds = [
					updatedLead.owner?.uid,
					...(updatedLead.assignees?.map((a: any) => a.uid) || []),
				].filter(Boolean);

				// Filter out inactive users before sending notifications
				const activeUserIds = await this.filterActiveUsers(userIds);

				if (activeUserIds.length > 0) {
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.LEAD_UPDATED,
						activeUserIds,
						{
							leadId: updatedLead.uid,
							leadName: updatedLead.name || `Lead #${updatedLead.uid}`,
							status: newStatus,
						},
						{
							priority: NotificationPriority.MEDIUM,
						},
					);
				}
			}

			this.logger.log(`Lead ${ref} reactivated from ${oldStatus} to ${newStatus} by user ${userId}`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`Error reactivating lead ${ref}: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * AUTOMATED LEAD SCORING: Update lead scores every hour
	 */
	@Cron('0 0 * * * *') // Every hour
	async hourlyLeadScoring(): Promise<void> {
		this.logger.log('Starting hourly lead scoring...');

		try {
			// Process lead scoring in batches to prevent memory issues
			const batchSize = 50;
			let offset = 0;
			let processedCount = 0;

			while (true) {
				const leads = await this.leadsRepository.find({
					where: {
						isDeleted: false,
						status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
					},
					take: batchSize,
					skip: offset,
					select: ['uid'], // Only select the ID to minimize memory usage
				});

				if (leads.length === 0) {
					break; // No more leads to process
				}

				// Process each lead individually with error handling
				const results = await Promise.allSettled(
					leads.map(async (lead) => {
						try {
							return await this.leadScoringService.calculateLeadScore(lead.uid);
						} catch (error) {
							this.logger.error(`Failed to score lead ${lead.uid}: ${error.message}`);
							return null;
						}
					}),
				);

				// Count successful operations
				const successful = results.filter(
					(result) => result.status === 'fulfilled' && result.value !== null,
				).length;
				processedCount += successful;

				offset += batchSize;
			}

			this.logger.log(`Hourly lead scoring completed: ${processedCount} leads processed`);
		} catch (error) {
			this.logger.error(`Hourly lead scoring failed: ${error.message}`, error.stack);
		}
	}

	/**
	 * AUTOMATED FOLLOW-UPS: Check for overdue follow-ups every 30 minutes
	 */
	@Cron('0 */30 * * * *') // Every 30 minutes
	async checkOverdueFollowUps(): Promise<void> {
		this.logger.log('Checking for overdue follow-ups...');

		try {
			const now = new Date();
			const overdueLeads = await this.leadsRepository.find({
				where: {
					isDeleted: false,
					nextFollowUpDate: Between(new Date('2020-01-01'), now), // Overdue
					status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
				},
				relations: ['owner'], // Removed 'assignees' since it's not a proper relation
			});

			this.logger.log(`Found ${overdueLeads.length} overdue leads to process`);

			for (const lead of overdueLeads) {
				try {
					// Notify assigned users about overdue follow-up
					const userIds = [lead.owner?.uid, ...(lead.assignees?.map((a: any) => a.uid) || [])].filter(
						Boolean,
					);

					// Filter out inactive users before sending notifications
					const activeUserIds = await this.filterActiveUsers(userIds);

					if (activeUserIds.length > 0) {
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.LEAD_FOLLOW_UP_OVERDUE,
							activeUserIds,
							{
								leadId: lead.uid,
								leadName: lead.name || `Lead #${lead.uid}`,
								daysOverdue: Math.floor(
									(now.getTime() - lead.nextFollowUpDate!.getTime()) / (24 * 60 * 60 * 1000),
								),
							},
							{
								priority: NotificationPriority.HIGH,
							},
						);
					}

					// Update priority if significantly overdue
					const daysOverdue = Math.floor(
						(now.getTime() - lead.nextFollowUpDate!.getTime()) / (24 * 60 * 60 * 1000),
					);
					if (daysOverdue > 7 && lead.priority !== LeadPriority.CRITICAL) {
						await this.leadsRepository.update(lead.uid, {
							priority: LeadPriority.HIGH,
							daysSinceLastResponse: daysOverdue,
						});
					}
				} catch (error) {
					this.logger.error(`Failed to process overdue follow-up for lead ${lead.uid}: ${error.message}`);
				}
			}

			this.logger.log(`Processed ${overdueLeads.length} overdue follow-ups`);
		} catch (error) {
			this.logger.error(`Follow-up check failed: ${error.message}`, error.stack);
		}
	}

	/**
	 * AUTOMATED TASK CREATION: Create tasks for idle leads (2+ days) daily at 8 AM
	 */
	@Cron('0 0 8 * * *') // Daily at 8 AM
	async createTasksForIdleLeads(): Promise<void> {
		this.logger.log('Creating tasks for idle leads...');

		try {
			const twoDaysAgo = new Date();
			twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

			// Find leads that haven't been contacted for 2+ days
			const idleLeads = await this.leadsRepository.find({
				where: {
					isDeleted: false,
					status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
					lastContactDate: Between(new Date('2020-01-01'), twoDaysAgo), // Last contacted 2+ days ago
				},
				relations: ['owner', 'organisation', 'branch'],
			});

			this.logger.log(`Found ${idleLeads.length} idle leads to create tasks for`);

			for (const lead of idleLeads) {
				try {
					// Check if a task already exists for this lead in the last 24 hours
					const existingTask = await this.taskRepository.findOne({
						where: {
							title: `Follow up on idle lead: ${lead.name || `Lead #${lead.uid}`}`,
							creator: { uid: lead.owner?.uid },
							createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)), // Last 24 hours
						},
					});

					if (existingTask) {
						this.logger.debug(`Task already exists for lead ${lead.uid}, skipping`);
						continue;
					}

					// Create deadline for today at 10 AM
					const taskDeadline = new Date();
					taskDeadline.setHours(10, 0, 0, 0);

					// If current time is already past 10 AM, set for tomorrow
					if (new Date().getHours() >= 10) {
						taskDeadline.setDate(taskDeadline.getDate() + 1);
					}

					// Create the task
					const taskData = {
						title: `Follow up on idle lead: ${lead.name || `Lead #${lead.uid}`}`,
						description: `This lead has been idle for ${Math.floor(
							(new Date().getTime() - lead.lastContactDate.getTime()) / (24 * 60 * 60 * 1000),
						)} days. Please follow up immediately.\n\nLead Details:\n- Name: ${lead.name || 'N/A'}\n- Company: ${
							lead.companyName || 'N/A'
						}\n- Email: ${lead.email || 'N/A'}\n- Phone: ${lead.phone || 'N/A'}\n- Status: ${
							lead.status
						}\n- Temperature: ${lead.temperature}\n- Notes: ${lead.notes || 'No notes available'}`,
						taskType: TaskType.FOLLOW_UP,
						priority: TaskPriority.HIGH,
						deadline: taskDeadline,
						creators: [{ uid: lead.owner?.uid }],
						assignees: [{ uid: lead.owner?.uid }],
						clients: [], // No specific client assignment
					};

					const result = await this.tasksService.create(
						taskData,
						lead.organisation?.uid,
						lead.branch?.uid,
					);

					if (result.message === process.env.SUCCESS_MESSAGE) {
						this.logger.log(`Created task for idle lead ${lead.uid} assigned to user ${lead.owner?.uid}`);
					} else {
						this.logger.error(`Failed to create task for idle lead ${lead.uid}: ${result.message}`);
					}
				} catch (error) {
					this.logger.error(`Failed to create task for idle lead ${lead.uid}: ${error.message}`);
				}
			}

			this.logger.log(`Completed creating tasks for ${idleLeads.length} idle leads`);
		} catch (error) {
			this.logger.error(`Idle lead task creation failed: ${error.message}`, error.stack);
		}
	}

	/**
	 * MONTHLY UNATTENDED LEADS EMAIL: Send monthly report on 28th
	 */
	@Cron('0 0 9 28 * *') // 28th of every month at 9 AM
	async sendMonthlyUnattendedLeadsEmail(): Promise<void> {
		this.logger.log('Sending monthly unattended leads email...');

		try {
			const now = new Date();
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
			const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

			// Get all users with leads
			const usersWithLeads = await this.userRepository.find({
				where: {
					status: In([AccountStatus.ACTIVE, AccountStatus.PENDING]),
				},
				relations: ['leads'],
			});

			for (const user of usersWithLeads) {
				try {
					// Find unattended leads for this user this month
					const unattendedLeads = await this.leadsRepository.find({
						where: {
							owner: { uid: user.uid },
							isDeleted: false,
							status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
							createdAt: Between(startOfMonth, endOfMonth),
							lastContactDate: null, // Never contacted
						},
						relations: ['owner', 'organisation', 'branch'],
					});

					// Also include leads that haven't been contacted for more than 7 days
					const stalledLeads = await this.leadsRepository.find({
						where: {
							owner: { uid: user.uid },
							isDeleted: false,
							status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
							createdAt: Between(startOfMonth, endOfMonth),
							lastContactDate: Between(new Date('2020-01-01'), new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // 7+ days ago
						},
						relations: ['owner', 'organisation', 'branch'],
					});

					const allUnattendedLeads = [...unattendedLeads, ...stalledLeads];

					if (allUnattendedLeads.length > 0) {
						// Send email to user
						await this.communicationService.sendEmail(
							EmailType.MONTHLY_UNATTENDED_LEADS_REPORT,
							[user.email],
							{
								name: user.name || user.username,
								month: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
								unattendedLeads: allUnattendedLeads.map((lead) => ({
									id: lead.uid,
									name: lead.name || `Lead #${lead.uid}`,
									companyName: lead.companyName || 'N/A',
									email: lead.email || 'N/A',
									phone: lead.phone || 'N/A',
									status: lead.status,
									temperature: lead.temperature,
									daysSinceCreated: Math.floor(
										(now.getTime() - lead.createdAt.getTime()) / (24 * 60 * 60 * 1000),
									),
									daysSinceLastContact: lead.lastContactDate
										? Math.floor(
												(now.getTime() - lead.lastContactDate.getTime()) / (24 * 60 * 60 * 1000),
										  )
										: 'Never contacted',
									estimatedValue: lead.estimatedValue || 0,
									priority: lead.priority,
									notes: lead.notes || 'No notes',
									leadUrl: `${this.configService.get<string>('DASHBOARD_URL')}/leads/${lead.uid}`,
								})),
								totalCount: allUnattendedLeads.length,
								totalEstimatedValue: allUnattendedLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0),
								dashboardUrl: this.configService.get<string>('DASHBOARD_URL'),
							},
						);

						this.logger.log(`Sent monthly unattended leads email to ${user.email} (${allUnattendedLeads.length} leads)`);
					} else {
						this.logger.debug(`No unattended leads found for user ${user.uid} this month`);
					}
				} catch (error) {
					this.logger.error(`Failed to send monthly email to user ${user.uid}: ${error.message}`);
				}
			}

			this.logger.log(`Completed monthly unattended leads email process`);
		} catch (error) {
			this.logger.error(`Monthly unattended leads email failed: ${error.message}`, error.stack);
		}
	}

	private calculateStats(leads: Lead[]): {
		total: number;
		pending: number;
		approved: number;
		inReview: number;
		declined: number;
	} {
		return {
			total: leads?.length || 0,
			pending: leads?.filter((lead) => lead?.status === LeadStatus.PENDING)?.length || 0,
			approved: leads?.filter((lead) => lead?.status === LeadStatus.APPROVED)?.length || 0,
			inReview: leads?.filter((lead) => lead?.status === LeadStatus.REVIEW)?.length || 0,
			declined: leads?.filter((lead) => lead?.status === LeadStatus.DECLINED)?.length || 0,
		};
	}

	async getLeadsForDate(date: Date): Promise<{
		message: string;
		leads: {
			pending: Lead[];
			approved: Lead[];
			review: Lead[];
			declined: Lead[];
			total: number;
		};
	}> {
		try {
			const leads = await this.leadsRepository.find({
				where: { createdAt: Between(startOfDay(date), endOfDay(date)) },
			});

			if (!leads) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Group leads by status
			const groupedLeads = {
				pending: leads.filter((lead) => lead.status === LeadStatus.PENDING),
				approved: leads.filter((lead) => lead.status === LeadStatus.APPROVED),
				review: leads.filter((lead) => lead.status === LeadStatus.REVIEW),
				declined: leads.filter((lead) => lead.status === LeadStatus.DECLINED),
				total: leads?.length,
			};

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				leads: groupedLeads,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				leads: null,
			};

			return response;
		}
	}

	async getLeadsReport(filter: any) {
		try {
			const leads = await this.leadsRepository.find({
				where: {
					...filter,
					isDeleted: false,
				},
				relations: ['owner', 'branch', 'client'],
			});

			if (!leads) {
				throw new NotFoundException('No leads found for the specified period');
			}

			const groupedLeads = {
				review: leads.filter((lead) => lead.status === LeadStatus.REVIEW),
				pending: leads.filter((lead) => lead.status === LeadStatus.PENDING),
				approved: leads.filter((lead) => lead.status === LeadStatus.APPROVED),
				declined: leads.filter((lead) => lead.status === LeadStatus.DECLINED),
			};

			const totalLeads = leads.length;
			const approvedLeads = groupedLeads.approved.length;
			const avgResponseTime = this.calculateAverageResponseTime(leads);
			const sources = this.analyzeLeadSources(leads);
			const sourceEffectiveness = this.analyzeSourceEffectiveness(leads);
			const geographicDistribution = this.analyzeGeographicDistribution(leads);
			const leadQualityBySource = this.analyzeLeadQualityBySource(leads);
			const conversionTrends = this.analyzeConversionTrends(leads);
			const responseTimeDistribution = this.analyzeResponseTimeDistribution(leads);

			return {
				...groupedLeads,
				total: totalLeads,
				metrics: {
					conversionRate: `${((approvedLeads / totalLeads) * 100).toFixed(1)}%`,
					averageResponseTime: `${avgResponseTime} hours`,
					topSources: sources,
					qualityScore: this.calculateQualityScore(leads),
					sourceEffectiveness,
					geographicDistribution,
					leadQualityBySource,
					conversionTrends,
					responseTimeDistribution,
				},
			};
		} catch (error) {
			return null;
		}
	}

	private calculateAverageResponseTime(leads: Lead[]): number {
		const respondedLeads = leads.filter(
			(lead) => lead.status === LeadStatus.APPROVED || lead.status === LeadStatus.DECLINED,
		);

		if (respondedLeads.length === 0) return 0;

		const totalResponseTime = respondedLeads.reduce((sum, lead) => {
			const responseTime = lead.updatedAt.getTime() - lead.createdAt.getTime();
			return sum + responseTime;
		}, 0);

		// Convert from milliseconds to hours
		return Number((totalResponseTime / (respondedLeads.length * 60 * 60 * 1000)).toFixed(1));
	}

	private analyzeLeadSources(leads: Lead[]): Array<{ source: string; count: number }> {
		const sourceCounts = leads.reduce((acc, lead) => {
			const source = lead.client?.category || 'Direct';
			acc[source] = (acc[source] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		return Object.entries(sourceCounts)
			.map(([source, count]) => ({ source, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5); // Return top 5 sources
	}

	private calculateQualityScore(leads: Lead[]): number {
		if (leads.length === 0) return 0;

		const approvedLeads = leads.filter((lead) => lead.status === LeadStatus.APPROVED).length;
		const responseTimeScore = this.calculateAverageResponseTime(leads) < 24 ? 1 : 0.5;
		const conversionRate = approvedLeads / leads.length;

		// Calculate score out of 100
		const score = (conversionRate * 0.6 + responseTimeScore * 0.4) * 100;
		return Number(score.toFixed(1));
	}

	private analyzeSourceEffectiveness(leads: Lead[]): Array<{
		source: string;
		totalLeads: number;
		convertedLeads: number;
		conversionRate: string;
		averageResponseTime: string;
		qualityScore: number;
	}> {
		const sourceStats = new Map<
			string,
			{
				total: number;
				converted: number;
				totalResponseTime: number;
				respondedLeads: number;
				qualityScores: number[];
			}
		>();

		leads.forEach((lead) => {
			const source = lead.client?.category || 'Direct';

			if (!sourceStats.has(source)) {
				sourceStats.set(source, {
					total: 0,
					converted: 0,
					totalResponseTime: 0,
					respondedLeads: 0,
					qualityScores: [],
				});
			}

			const stats = sourceStats.get(source);
			stats.total++;

			if (lead.status === LeadStatus.APPROVED) {
				stats.converted++;
			}

			if (lead.status !== LeadStatus.PENDING) {
				stats.respondedLeads++;
				stats.totalResponseTime += lead.updatedAt.getTime() - lead.createdAt.getTime();
			}

			stats.qualityScores.push(this.calculateIndividualLeadQualityScore(lead));
		});

		return Array.from(sourceStats.entries())
			.map(([source, stats]) => ({
				source,
				totalLeads: stats.total,
				convertedLeads: stats.converted,
				conversionRate: `${((stats.converted / stats.total) * 100).toFixed(1)}%`,
				averageResponseTime: `${(stats.respondedLeads > 0
					? stats.totalResponseTime / (stats.respondedLeads * 60 * 60 * 1000)
					: 0
				).toFixed(1)} hours`,
				qualityScore: Number(
					(stats.qualityScores.reduce((sum, score) => sum + score, 0) / stats.total).toFixed(1),
				),
			}))
			.sort((a, b) => b.convertedLeads - a.convertedLeads);
	}

	private analyzeGeographicDistribution(leads: Lead[]): Record<
		string,
		{
			total: number;
			converted: number;
			conversionRate: string;
		}
	> {
		const geoStats = new Map<
			string,
			{
				total: number;
				converted: number;
			}
		>();

		leads.forEach((lead) => {
			const region = lead?.client?.address?.city || 'Unknown';

			if (!geoStats.has(region)) {
				geoStats.set(region, {
					total: 0,
					converted: 0,
				});
			}

			const stats = geoStats.get(region);
			stats.total++;
			if (lead.status === LeadStatus.APPROVED) {
				stats.converted++;
			}
		});

		return Object.fromEntries(
			Array.from(geoStats.entries()).map(([region, stats]) => [
				region,
				{
					total: stats.total,
					converted: stats.converted,
					conversionRate: `${((stats.converted / stats.total) * 100).toFixed(1)}%`,
				},
			]),
		);
	}

	private analyzeLeadQualityBySource(leads: Lead[]): Array<{
		source: string;
		averageQualityScore: number;
		leadDistribution: {
			high: number;
			medium: number;
			low: number;
		};
	}> {
		const sourceQuality = new Map<
			string,
			{
				scores: number[];
				distribution: {
					high: number;
					medium: number;
					low: number;
				};
			}
		>();

		leads.forEach((lead) => {
			const source = lead.client?.category || 'Direct';
			const qualityScore = this.calculateIndividualLeadQualityScore(lead);

			if (!sourceQuality.has(source)) {
				sourceQuality.set(source, {
					scores: [],
					distribution: {
						high: 0,
						medium: 0,
						low: 0,
					},
				});
			}

			const stats = sourceQuality.get(source);
			stats.scores.push(qualityScore);

			if (qualityScore >= 80) stats.distribution.high++;
			else if (qualityScore >= 50) stats.distribution.medium++;
			else stats.distribution.low++;
		});

		return Array.from(sourceQuality.entries())
			.map(([source, stats]) => ({
				source,
				averageQualityScore: Number(
					(stats.scores.reduce((sum, score) => sum + score, 0) / stats.scores.length).toFixed(1),
				),
				leadDistribution: stats.distribution,
			}))
			.sort((a, b) => b.averageQualityScore - a.averageQualityScore);
	}

	private analyzeConversionTrends(leads: Lead[]): Array<{
		date: string;
		totalLeads: number;
		convertedLeads: number;
		conversionRate: string;
	}> {
		const dailyStats = new Map<
			string,
			{
				total: number;
				converted: number;
			}
		>();

		leads.forEach((lead) => {
			const date = lead.createdAt.toISOString().split('T')[0];

			if (!dailyStats.has(date)) {
				dailyStats.set(date, {
					total: 0,
					converted: 0,
				});
			}

			const stats = dailyStats.get(date);
			stats.total++;
			if (lead.status === LeadStatus.APPROVED) {
				stats.converted++;
			}
		});

		return Array.from(dailyStats.entries())
			.map(([date, stats]) => ({
				date,
				totalLeads: stats.total,
				convertedLeads: stats.converted,
				conversionRate: `${((stats.converted / stats.total) * 100).toFixed(1)}%`,
			}))
			.sort((a, b) => a.date.localeCompare(b.date));
	}

	private analyzeResponseTimeDistribution(leads: Lead[]): Record<string, number> {
		const distribution = {
			'Under 1 hour': 0,
			'1-4 hours': 0,
			'4-12 hours': 0,
			'12-24 hours': 0,
			'Over 24 hours': 0,
		};

		leads.forEach((lead) => {
			if (lead.status === LeadStatus.PENDING) return;

			const responseTime = (lead.updatedAt.getTime() - lead.createdAt.getTime()) / (60 * 60 * 1000); // hours

			if (responseTime < 1) distribution['Under 1 hour']++;
			else if (responseTime < 4) distribution['1-4 hours']++;
			else if (responseTime < 12) distribution['4-12 hours']++;
			else if (responseTime < 24) distribution['12-24 hours']++;
			else distribution['Over 24 hours']++;
		});

		return distribution;
	}

	private calculateIndividualLeadQualityScore(lead: Lead): number {
		let score = 0;

		// Response time score (40%)
		if (lead.status !== LeadStatus.PENDING) {
			const responseTime = (lead.updatedAt.getTime() - lead.createdAt.getTime()) / (60 * 60 * 1000);
			if (responseTime < 1) score += 40;
			else if (responseTime < 4) score += 30;
			else if (responseTime < 12) score += 20;
			else if (responseTime < 24) score += 10;
		}

		// Status score (30%)
		if (lead.status === LeadStatus.APPROVED) score += 30;
		else if (lead.status === LeadStatus.REVIEW) score += 15;

		// Data completeness score (30%)
		if (lead.client) {
			if (lead.client.email) score += 10;
			if (lead.client.phone) score += 10;
			if (lead.client.address) score += 10;
		}

		return score;
	}

	/**
	 * Populates the assignees field of a lead with the full user objects
	 */
	private async populateLeadRelations(lead: Lead): Promise<Lead> {
		if (lead.assignees?.length > 0) {
			const assigneeIds = lead.assignees.map((a) => a.uid);
			const assigneeProfiles = await this.userRepository.find({
				where: { uid: In(assigneeIds) },
				select: ['uid', 'username', 'name', 'surname', 'email', 'phone', 'photoURL', 'accessLevel', 'status'],
			});
			lead.assignees = assigneeProfiles;
		}

		// Populate change history with user details
		await this.populateLeadChangeHistory(lead);

		return lead;
	}

	/**
	 * Populates the user details in the changeHistory array of a lead
	 */
	private async populateLeadChangeHistory(lead: Lead): Promise<Lead> {
		if (lead.changeHistory?.length > 0) {
			// Extract all userIds from change history
			const userIds = lead.changeHistory
				.filter((entry) => entry.userId)
				.map((entry) => (typeof entry.userId === 'string' ? parseInt(entry.userId) : entry.userId));

			if (userIds.length > 0) {
				// Find all user details in one query
				const users = await this.userRepository.find({
					where: { uid: In(userIds) },
					select: [
						'uid',
						'username',
						'name',
						'surname',
						'email',
						'phone',
						'photoURL',
						'accessLevel',
						'status',
					],
				});

				// Create a map for quick lookup
				const userMap = new Map(users.map((user) => [user.uid.toString(), user]));

				// Update the changeHistory entries with user details
				lead.changeHistory = lead.changeHistory.map((entry) => ({
					...entry,
					user: entry.userId ? userMap.get(entry.userId.toString()) || null : null,
				}));
			}
		}
		return lead;
	}

	/**
	 * Set intelligent defaults for new leads
	 */
	private async setIntelligentDefaults(lead: Lead): Promise<void> {
		// Set default temperature based on source
		if (!lead.temperature) {
			switch (lead.source) {
				case 'REFERRAL':
					lead.temperature = LeadTemperature.WARM;
					break;
				case 'WEBSITE':
				case 'ORGANIC_SEARCH':
					lead.temperature = LeadTemperature.COLD;
					break;
				case 'COLD_CALL':
				case 'EMAIL_CAMPAIGN':
					lead.temperature = LeadTemperature.COLD;
					break;
				default:
					lead.temperature = LeadTemperature.COLD;
			}
		}

		// Set default priority based on budget range
		if (!lead.priority && lead.budgetRange) {
			if (['OVER_1M', 'R500K_1M', 'R250K_500K'].includes(lead.budgetRange)) {
				lead.priority = LeadPriority.HIGH;
			} else if (['R100K_250K', 'R50K_100K'].includes(lead.budgetRange)) {
				lead.priority = LeadPriority.MEDIUM;
			}
		}

		// Set initial next follow-up date
		if (!lead.nextFollowUpDate) {
			const nextFollowUp = new Date();
			nextFollowUp.setDate(nextFollowUp.getDate() + 1); // Follow up tomorrow for new leads
			lead.nextFollowUpDate = nextFollowUp;
		}

		// Initialize scoring data
		lead.leadScore = 0;
		lead.totalInteractions = 0;
		lead.averageResponseTime = 0;
		lead.daysSinceLastResponse = 0;
	}

	/**
	 * Apply intelligent updates based on data changes
	 */
	private async applyIntelligentUpdates(lead: Lead, updates: Partial<Lead>): Promise<void> {
		// Update temperature if intent changed
		if (updates.intent && updates.intent !== lead.intent) {
			switch (updates.intent) {
				case 'PURCHASE':
					updates.temperature = LeadTemperature.HOT;
					updates.priority = LeadPriority.HIGH;
					break;
				case 'CONVERSION':
					updates.temperature = LeadTemperature.HOT;
					break;
				case 'LOST':
					updates.temperature = LeadTemperature.FROZEN;
					updates.priority = LeadPriority.LOW;
					break;
			}
		}

		// Auto-set next follow-up date based on temperature
		if (updates.temperature && updates.temperature !== lead.temperature) {
			const followUpDays = this.getFollowUpDaysForTemperature(updates.temperature);
			const nextFollowUp = new Date();
			nextFollowUp.setDate(nextFollowUp.getDate() + followUpDays);
			updates.nextFollowUpDate = nextFollowUp;
		}

		// Update lifecycle stage based on status
		if (updates.status && updates.status !== lead.status) {
			switch (updates.status) {
				case LeadStatus.APPROVED:
					updates.lifecycleStage = LeadLifecycleStage.SALES_QUALIFIED_LEAD;
					break;
				case LeadStatus.CONVERTED:
					updates.lifecycleStage = LeadLifecycleStage.CUSTOMER;
					break;
			}
		}
	}

	/**
	 * Handle events triggered after lead creation
	 */
	private async handleLeadCreatedEvents(lead: Lead): Promise<void> {
		try {
			// 1. Calculate initial lead score
			await this.leadScoringService.calculateLeadScore(lead.uid);
			await this.leadScoringService.updateActivityData(lead.uid);

			// 2. Send assignment notifications
			if (lead.assignees && lead.assignees.length > 0) {
				await this.sendAssignmentNotifications(lead, 'assigned');
			}

			// 3. Award XP to creator
			if (lead.owner?.uid) {
				await this.rewardsService.awardXP({
					owner: lead.owner.uid,
					amount: XP_VALUES.LEAD,
					action: XP_VALUES_TYPES.LEAD,
					source: {
						id: lead.uid.toString(),
						type: XP_VALUES_TYPES.LEAD,
						details: 'Lead created',
					},
				}, lead.organisation?.uid, lead.branch?.uid);
			}

			// 4. Send system notification
			const notification = {
				type: NotificationType.USER,
				title: 'New Lead Created',
				message: `Lead "${lead.name || `#${lead.uid}`}" has been created`,
				status: NotificationStatus.UNREAD,
				owner: lead.owner,
			};

			const recipients = [AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.SUPERVISOR];

			this.eventEmitter.emit('send.notification', notification, recipients);

			this.logger.log(`Lead creation events completed for lead ${lead.uid}`);
		} catch (error) {
			this.logger.error(
				`Failed to handle lead creation events for lead ${lead.uid}: ${error.message}`,
				error.stack,
			);
		}
	}

	/**
	 * Handle events triggered after lead updates
	 */
	private async handleLeadUpdatedEvents(
		lead: Lead,
		changes: {
			statusChanged: boolean;
			temperatureChanged: boolean;
			priorityChanged: boolean;
			assigneesChanged: boolean;
		},
	): Promise<void> {
		try {
			// 1. Recalculate lead score if significant changes
			if (changes.statusChanged || changes.temperatureChanged || changes.priorityChanged) {
				await this.leadScoringService.calculateLeadScore(lead.uid);
				await this.leadScoringService.updateActivityData(lead.uid);
			}

			// 2. Handle status-specific events
			if (changes.statusChanged) {
				await this.handleStatusChangeEvents(lead);
			}

			// 3. Handle assignment changes
			if (changes.assigneesChanged) {
				await this.sendAssignmentNotifications(lead, 'updated');
			}

			// 4. Update temperature based on new score if needed
			if (changes.statusChanged || changes.priorityChanged) {
				await this.updateTemperatureBasedOnScore(lead.uid);
			}

			this.logger.log(`Lead update events completed for lead ${lead.uid}`);
		} catch (error) {
			this.logger.error(
				`Failed to handle lead update events for lead ${lead.uid}: ${error.message}`,
				error.stack,
			);
		}
	}

	/**
	 * Handle status change specific events
	 */
	private async handleStatusChangeEvents(lead: Lead): Promise<void> {
		if (lead.status === LeadStatus.CONVERTED) {
			// Send conversion notifications
			const allUserIds = [
				lead.owner?.uid,
				...(lead.assignees?.map((assignee: any) => assignee.uid) || []),
			].filter(Boolean);

			if (allUserIds.length > 0) {
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.LEAD_CONVERTED,
					allUserIds,
					{
						leadId: lead.uid,
						leadName: lead.name || `#${lead.uid}`,
						convertedBy: 'System',
					},
					{
						priority: NotificationPriority.HIGH,
					},
				);
			}

			// Award bonus XP for conversion
			if (lead.owner?.uid) {
				await this.rewardsService.awardXP({
					owner: lead.owner.uid,
					amount: XP_VALUES.LEAD * 3, // Triple XP for conversion
					action: 'LEAD_CONVERSION',
					source: {
						id: lead.uid.toString(),
						type: 'lead_conversion',
						details: 'Lead converted to customer',
					},
				}, lead.organisation?.uid, lead.branch?.uid);
			}
		}
	}

	/**
	 * Send assignment notifications
	 */
	/**
	 * Check if a user is active and should receive notifications
	 */
	private isUserActive(user: User): boolean {
		return !this.INACTIVE_USER_STATUSES.includes(user.status as AccountStatus);
	}

	/**
	 * Filter active users from a list of users
	 */
	private async filterActiveUsers(userIds: number[]): Promise<number[]> {
		if (userIds.length === 0) return [];

		const users = await this.userRepository.find({
			where: { uid: In(userIds) },
			select: ['uid', 'status'],
		});

		const activeUserIds = users
			.filter(user => this.isUserActive(user))
			.map(user => user.uid);

		const filteredCount = userIds.length - activeUserIds.length;
		if (filteredCount > 0) {
			this.logger.debug(`🚫 Filtered out ${filteredCount} inactive users from lead notifications`);
		}

		return activeUserIds;
	}

	private async sendAssignmentNotifications(lead: Lead, action: 'assigned' | 'updated'): Promise<void> {
		const populatedLead = await this.populateLeadRelations(lead);

		if (populatedLead.assignees && populatedLead.assignees.length > 0) {
			const assigneeIds = populatedLead.assignees.map((assignee: User) => assignee.uid);
			
			// Filter out inactive users before sending notifications
			const activeAssigneeIds = await this.filterActiveUsers(assigneeIds);
			
			if (activeAssigneeIds.length === 0) {
				this.logger.debug(`No active assignees found for lead ${populatedLead.uid}, skipping notifications`);
				return;
			}

			const creatorName = populatedLead.owner?.name || populatedLead.owner?.username || 'System';

			try {
				await this.unifiedNotificationService.sendTemplatedNotification(
					action === 'assigned' ? NotificationEvent.LEAD_ASSIGNED : NotificationEvent.LEAD_UPDATED,
					activeAssigneeIds,
					{
						leadId: populatedLead.uid,
						leadName: populatedLead.name,
						assignedBy: creatorName,
						leadDetails: populatedLead.notes,
						leadCreatorName: creatorName,
					},
					{
						sendEmail: true,
						emailTemplate: EmailType.LEAD_ASSIGNED_TO_USER,
						emailData: {
							name: 'Team Member',
							assigneeName: 'Team Member',
							leadId: populatedLead.uid,
							leadName: populatedLead.name,
							leadCreatorName: creatorName,
							leadDetails: populatedLead.notes,
							leadLink: `${this.configService.get<string>('DASHBOARD_URL')}/leads/${populatedLead.uid}`,
						},
					},
				);
			} catch (error) {
				this.logger.error(`Failed to send assignment notifications: ${error.message}`);
			}
		}
	}

	/**
	 * Update temperature based on lead score
	 */
	private async updateTemperatureBasedOnScore(leadId: number): Promise<void> {
		const lead = await this.leadsRepository.findOne({ where: { uid: leadId } });
		if (!lead) return;

		let newTemperature = lead.temperature;

		// Auto-adjust temperature based on score
		if (lead.leadScore >= 80) {
			newTemperature = LeadTemperature.HOT;
		} else if (lead.leadScore >= 60) {
			newTemperature = LeadTemperature.WARM;
		} else if (lead.leadScore >= 30) {
			newTemperature = LeadTemperature.COLD;
		} else {
			newTemperature = LeadTemperature.FROZEN;
		}

		// Only update if temperature actually changed
		if (newTemperature !== lead.temperature) {
			await this.leadsRepository.update(leadId, { temperature: newTemperature });
			this.logger.log(
				`Updated temperature for lead ${leadId} from ${lead.temperature} to ${newTemperature} based on score ${lead.leadScore}`,
			);
		}
	}

	/**
	 * Get follow-up days based on temperature
	 */
	private getFollowUpDaysForTemperature(temperature: LeadTemperature): number {
		switch (temperature) {
			case LeadTemperature.HOT:
				return 1; // Daily follow-up
			case LeadTemperature.WARM:
				return 3; // Every 3 days
			case LeadTemperature.COLD:
				return 7; // Weekly
			case LeadTemperature.FROZEN:
				return 30; // Monthly
			default:
				return 7;
		}
	}

	/**
	 * Generate intelligent email using enhanced AI system with rich lead data
	 */
	async generateIntelligentEmail(
		leadId: number,
		templateType: string,
		customMessage?: string,
		tone?: any,
		orgId?: number,
		branchId?: number,
	): Promise<{
		success: boolean;
		email?: {
			subject: string;
			body: string;
			followUpReminder?: string;
			personalizationScore?: number;
			keyPersonalizationElements?: string[];
			alternativeSubjectLines?: string[];
			responseStrategy?: string;
		};
		message: string;
	}> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Get the lead with all related data
			const lead = await this.leadsRepository.findOne({
				where: {
					uid: leadId,
					isDeleted: false,
					organisation: { uid: orgId },
					...(branchId && { branch: { uid: branchId } }),
				},
				relations: ['owner', 'organisation', 'branch', 'interactions'],
			});

			if (!lead) {
				return {
					success: false,
					message: 'Lead not found',
				};
			}

			// Transform lead data to enhanced format for AI
			const enhancedLeadData = {
				uid: lead.uid,
				name: lead.name,
				email: lead.email,
				phone: lead.phone,
				companyName: lead.companyName,
				jobTitle: lead.jobTitle,

				// Lead qualification and scoring
				status: lead.status,
				intent: lead.intent,
				temperature: lead.temperature,
				priority: lead.priority,
				leadScore: lead.leadScore,
				userQualityRating: lead.userQualityRating,
				lifecycleStage: lead.lifecycleStage,

				// Business context
				industry: lead.industry,
				businessSize: lead.businessSize,
				decisionMakerRole: lead.decisionMakerRole,
				budgetRange: lead.budgetRange,
				purchaseTimeline: lead.purchaseTimeline,
				estimatedValue: lead.estimatedValue,

				// Communication and behavior
				source: lead.source,
				preferredCommunication: lead.preferredCommunication,
				timezone: lead.timezone,
				bestContactTime: lead.bestContactTime,
				averageResponseTime: lead.averageResponseTime,
				totalInteractions: lead.totalInteractions,
				daysSinceLastResponse: lead.daysSinceLastResponse,
				lastContactDate: lead.lastContactDate?.toISOString(),
				nextFollowUpDate: lead.nextFollowUpDate?.toISOString(),

				// Business intelligence
				painPoints: lead.painPoints ? JSON.parse(lead.painPoints) : [],
				competitorInfo: lead.competitorInfo,
				referralSource: lead.referralSource,
				campaignName: lead.campaignName,
				utmSource: lead.utmSource,
				utmMedium: lead.utmMedium,
				utmCampaign: lead.utmCampaign,

				// Activity and engagement data
				scoringData: lead.scoringData,
				activityData: lead.activityData,

				// Additional context
				notes: lead.notes,
				assignee: lead.owner?.name,
				customFields: lead.customFields,
			};

			// Set intelligent tone defaults if not provided
			const intelligentTone = tone || {
				baseTone: this.selectOptimalTone(enhancedLeadData),
				intensity: this.selectToneIntensity(enhancedLeadData),
				regionalAdaptation: 'south_african',
				industrySpecific: true,
			};

			// Prepare the AI request
			const aiRequest = {
				recipientName: lead.name || 'Valued Contact',
				recipientEmail: lead.email || '',
				leadData: enhancedLeadData,
				templateType: templateType as any,
				tone: intelligentTone,
				customMessage: customMessage,
				industryInsights: this.generateIndustryInsights(lead.industry),
				competitiveContext: lead.competitorInfo ? [`Currently evaluating: ${lead.competitorInfo}`] : [],
				urgencyFactors: this.generateUrgencyFactors(enhancedLeadData),
				businessContext: {
					marketConditions: this.generateMarketConditions(lead.industry),
					seasonalFactors: this.generateSeasonalFactors(),
				},
			};

			// Call the enhanced AI email generation API
			const response = await fetch(`${process.env.DASHBOARD_URL}/api/ai/email`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(aiRequest),
			});

			if (!response.ok) {
				throw new Error(`AI service responded with status: ${response.status}`);
			}

			const emailData = await response.json();

			return {
				success: true,
				email: {
					subject: emailData.subject,
					body: emailData.body,
					followUpReminder: emailData.followUpReminder,
					personalizationScore: emailData.personalizationScore,
					keyPersonalizationElements: emailData.keyPersonalizationElements,
					alternativeSubjectLines: emailData.alternativeSubjectLines,
					responseStrategy: emailData.responseStrategy,
				},
				message: 'Email generated successfully',
			};
		} catch (error) {
			this.logger.error(`Error generating intelligent email for lead ${leadId}: ${error.message}`, error.stack);
			return {
				success: false,
				message: `Failed to generate email: ${error.message}`,
			};
		}
	}

	/**
	 * Select optimal tone based on lead intelligence
	 */
	private selectOptimalTone(leadData: any): string {
		// High-score or hot leads get more confident approach
		if (leadData.temperature === 'HOT' || (leadData.leadScore && leadData.leadScore > 80)) {
			return leadData.decisionMakerRole === 'CEO' || leadData.decisionMakerRole === 'OWNER'
				? 'authoritative'
				: 'results-driven';
		}

		// Technical decision makers prefer consultative approach
		if (leadData.decisionMakerRole === 'CTO' || leadData.industry === 'TECHNOLOGY') {
			return 'consultative';
		}

		// Financial decision makers prefer data-driven approach
		if (leadData.decisionMakerRole === 'CFO' || leadData.industry === 'FINANCE') {
			return 'results-driven';
		}

		// Educational approach for early-stage leads
		if (leadData.temperature === 'COLD' || leadData.lifecycleStage === 'LEAD') {
			return 'educational';
		}

		return 'collaborative';
	}

	/**
	 * Select tone intensity based on lead characteristics
	 */
	private selectToneIntensity(leadData: any): string {
		if (leadData.temperature === 'HOT' && leadData.priority === 'HIGH') {
			return 'strong';
		} else if (leadData.temperature === 'WARM' || leadData.priority === 'MEDIUM') {
			return 'moderate';
		}
		return 'subtle';
	}

	/**
	 * Generate industry-specific insights
	 */
	private generateIndustryInsights(industry?: string): string[] {
		const insights: Record<string, string[]> = {
			TECHNOLOGY: [
				'Digital transformation acceleration in SA market',
				'Cybersecurity and data protection priorities',
				'Cloud adoption and skills shortage challenges',
			],
			HEALTHCARE: [
				'Healthcare digitization trends',
				'Telemedicine and patient data security',
				'Cost optimization and efficiency improvements',
			],
			FINANCE: [
				'Fintech disruption and digital banking',
				'Regulatory compliance (POPIA, Basel III)',
				'Customer experience transformation',
			],
			RETAIL: [
				'Omnichannel retail evolution',
				'Supply chain optimization',
				'Customer data analytics and personalization',
			],
			MANUFACTURING: [
				'Industry 4.0 and smart manufacturing',
				'Supply chain resilience',
				'Sustainability and carbon reduction',
			],
			MINING: [
				'Safety technology and compliance',
				'Operational efficiency optimization',
				'Environmental impact management',
			],
		};

		return (
			insights[industry as string] || [
				'Digital transformation opportunities',
				'Operational efficiency improvements',
				'Competitive advantage enhancement',
			]
		);
	}

	/**
	 * Generate urgency factors based on lead data
	 */
	private generateUrgencyFactors(leadData: any): string[] {
		const factors: string[] = [];

		if (leadData.temperature === 'HOT') {
			factors.push('High-interest lead requiring immediate attention');
		}

		if (leadData.purchaseTimeline === 'IMMEDIATE') {
			factors.push('Immediate purchase timeline');
		} else if (leadData.purchaseTimeline === 'SHORT_TERM') {
			factors.push('Short-term purchase timeline (1-4 weeks)');
		}

		if (leadData.daysSinceLastResponse && leadData.daysSinceLastResponse > 7) {
			factors.push('Extended period since last contact');
		}

		if (leadData.competitorInfo) {
			factors.push('Actively considering competitive solutions');
		}

		if (leadData.budgetRange && ['OVER_1M', 'R500K_1M'].includes(leadData.budgetRange)) {
			factors.push('High-value opportunity');
		}

		return factors;
	}

	/**
	 * Generate market conditions based on industry
	 */
	private generateMarketConditions(industry?: string): string[] {
		const conditions: Record<string, string[]> = {
			RETAIL: ['Consumer spending pressure', 'Supply chain challenges'],
			MANUFACTURING: ['Raw material cost inflation', 'Skills shortage'],
			TECHNOLOGY: ['Digital acceleration', 'Cybersecurity concerns'],
			FINANCE: ['Regulatory changes', 'Digital disruption'],
			HEALTHCARE: ['Healthcare transformation', 'Cost pressures'],
			MINING: ['Commodity price volatility', 'Environmental regulations'],
		};

		return conditions[industry as string] || ['Economic uncertainty', 'Digital transformation pressure'];
	}

	/**
	 * Generate seasonal factors
	 */
	private generateSeasonalFactors(): string[] {
		const currentMonth = new Date().getMonth();
		if (currentMonth >= 10 || currentMonth <= 1) {
			return ['Year-end budget considerations', 'Holiday season planning'];
		} else if (currentMonth >= 2 && currentMonth <= 4) {
			return ['New year implementation planning', 'Q1 priority setting'];
		}
		return ['Mid-year review and planning', 'Summer business cycles'];
	}

	/**
	 * Update lead status with enhanced automatic temperature adjustment
	 * Enhanced with status validation and velocity-based scoring
	 */
	async updateLeadStatus(
		id: number,
		status: LeadStatus,
		reason?: string,
		description?: string,
		nextStep?: string,
	): Promise<Lead> {
		const result = await this.findOne(id);
		if (!result.lead) {
			throw new NotFoundException(`Lead with ID ${id} not found`);
		}

		const lead = result.lead;

		// Store previous values for comparison
		const previousStatus = lead.status;
		const previousTemperature = lead.temperature;

		// Update the lead status
		lead.status = status;
		lead.updatedAt = new Date();

		// Enhanced status-aware temperature adjustment with velocity intelligence
		await this.updateTemperatureBasedOnStatus(lead, previousStatus);

		// Recalculate scores with new status and temperature
		await this.leadScoringService.calculateLeadScore(id);
		await this.leadScoringService.updateActivityData(id);

		// Update audit trail - removing non-existent properties
		// Note: Lead entity doesn't have reason, description, nextStep properties
		// These would need to be tracked in a separate audit/history table

		const savedLead = await this.leadsRepository.save(lead);

		// Log significant changes
		if (previousStatus !== status || previousTemperature !== lead.temperature) {
			this.logger.log(
				`Lead ${id} status updated: ${previousStatus} → ${status}, ` +
					`temperature: ${previousTemperature} → ${lead.temperature}, ` +
					`score: ${lead.leadScore || 0}`,
			);
		}

		return savedLead;
	}

	/**
	 * Enhanced temperature adjustment based on status and velocity intelligence
	 */
	private async updateTemperatureBasedOnStatus(lead: Lead, previousStatus?: LeadStatus): Promise<void> {
		const currentScore = lead.leadScore || 0;
		const now = new Date();
		const statusChangeTime =
			previousStatus && previousStatus !== lead.status
				? (now.getTime() - new Date(lead.updatedAt).getTime()) / (1000 * 60 * 60) // Hours since last update
				: 0;

		// Status-based temperature rules with velocity intelligence
		switch (lead.status) {
			case LeadStatus.APPROVED:
				// APPROVED leads cannot be COLD or FROZEN
				if (lead.temperature === LeadTemperature.COLD || lead.temperature === LeadTemperature.FROZEN) {
					// Determine new temperature based on score and velocity
					if (currentScore >= 70 || statusChangeTime <= 24) {
						// High score or fast progression
						lead.temperature = LeadTemperature.HOT;
					} else {
						lead.temperature = LeadTemperature.WARM;
					}
				}
				// If already HOT/WARM, maintain or upgrade based on velocity
				else if (statusChangeTime <= 6) {
					// Very fast approval (within 6 hours)
					lead.temperature = LeadTemperature.HOT;
				}
				break;

			case LeadStatus.CONVERTED:
				// CONVERTED leads must be HOT (they completed the journey)
				lead.temperature = LeadTemperature.HOT;
				break;

			case LeadStatus.REVIEW:
				// REVIEW status with scoring-based temperature
				if (currentScore >= 80) {
					lead.temperature = LeadTemperature.HOT;
				} else if (currentScore >= 60) {
					lead.temperature = LeadTemperature.WARM;
				} else if (currentScore >= 40) {
					lead.temperature = LeadTemperature.COLD;
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;

			case LeadStatus.PENDING:
				// PENDING leads get temperature based on score and velocity
				if (statusChangeTime > 0) {
					// Status just changed
					if (statusChangeTime <= 2) {
						// Very recent activity
						lead.temperature =
							lead.temperature && lead.temperature > LeadTemperature.COLD
								? lead.temperature
								: LeadTemperature.WARM;
					} else if (statusChangeTime > 168) {
						// Over a week old
						lead.temperature = LeadTemperature.COLD;
					}
				}
				// Adjust based on score if no recent status change
				if (currentScore >= 75) {
					lead.temperature = LeadTemperature.HOT;
				} else if (currentScore >= 50) {
					lead.temperature = LeadTemperature.WARM;
				} else if (currentScore >= 25) {
					lead.temperature = LeadTemperature.COLD;
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;

			case LeadStatus.DECLINED:
			case LeadStatus.CANCELLED:
				// Declined/cancelled leads cool down over time but may have potential
				if (currentScore >= 60) {
					lead.temperature = LeadTemperature.COLD; // Still has potential
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;

			default:
				// For any other status, use score-based assignment
				if (currentScore >= 75) {
					lead.temperature = LeadTemperature.HOT;
				} else if (currentScore >= 50) {
					lead.temperature = LeadTemperature.WARM;
				} else if (currentScore >= 25) {
					lead.temperature = LeadTemperature.COLD;
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;
		}

		// Additional velocity-based adjustments
		await this.applyVelocityBasedTemperatureAdjustments(lead, statusChangeTime);
	}

	/**
	 * Apply velocity-based temperature adjustments
	 */
	private async applyVelocityBasedTemperatureAdjustments(lead: Lead, statusChangeTime: number): Promise<void> {
		// Get recent interactions for velocity analysis
		const recentInteractions = await this.interactionRepository.find({
			where: {
				lead: { uid: lead.uid },
				createdAt: MoreThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // Last 7 days
			},
			order: { createdAt: 'DESC' },
		});

		const interactionVelocity = recentInteractions.length;

		// Very fast progression (status change within hours) = HOT boost
		if (statusChangeTime > 0 && statusChangeTime <= 6 && lead.temperature !== LeadTemperature.HOT) {
			if (lead.status === LeadStatus.APPROVED || lead.status === LeadStatus.REVIEW) {
				lead.temperature = LeadTemperature.HOT;
			}
		}

		// High interaction velocity = temperature boost
		if (interactionVelocity >= 5 && lead.temperature === LeadTemperature.COLD) {
			lead.temperature = LeadTemperature.WARM;
		} else if (interactionVelocity >= 8 && lead.temperature === LeadTemperature.WARM) {
			lead.temperature = LeadTemperature.HOT;
		}

		// Very slow progression (status unchanged for too long) = cooling down
		const daysSinceUpdate = Math.floor(
			(new Date().getTime() - new Date(lead.updatedAt).getTime()) / (24 * 60 * 60 * 1000),
		);

		if (daysSinceUpdate > 14 && lead.temperature === LeadTemperature.HOT) {
			lead.temperature = LeadTemperature.WARM;
		} else if (daysSinceUpdate > 30 && lead.temperature === LeadTemperature.WARM) {
			lead.temperature = LeadTemperature.COLD;
		} else if (daysSinceUpdate > 60 && lead.temperature === LeadTemperature.COLD) {
			lead.temperature = LeadTemperature.FROZEN;
		}
	}

	/**
	 * Enhanced bulk temperature update with velocity-aware logic
	 */
	async updateLeadTemperatures(): Promise<void> {
		this.logger.log('Starting enhanced bulk temperature update...');

		const leads = await this.leadsRepository.find({
			where: { isDeleted: false },
			relations: ['interactions'],
		});

		let updated = 0;
		for (const lead of leads) {
			try {
				const originalTemperature = lead.temperature;

				// Recalculate score first
				await this.leadScoringService.calculateLeadScore(lead.uid);

				// Update temperature based on current status and score
				await this.updateTemperatureBasedOnStatus(lead);

				if (originalTemperature !== lead.temperature) {
					await this.leadsRepository.save(lead);
					updated++;

					this.logger.debug(
						`Lead ${lead.uid} temperature updated: ${originalTemperature} → ${lead.temperature} ` +
							`(Status: ${lead.status}, Score: ${lead.leadScore || 0})`,
					);
				}
			} catch (error) {
				this.logger.error(`Failed to update temperature for lead ${lead.uid}: ${error.message}`);
			}
		}

		this.logger.log(`Completed bulk temperature update. Updated ${updated}/${leads.length} leads.`);
	}

	/**
	 * Enhanced automatic lead processing with velocity intelligence
	 */
	async processLeadAutomatically(leadId: number): Promise<Lead> {
		const lead = await this.findOne(leadId);
		if (!lead.lead) {
			throw new NotFoundException(`Lead with ID ${leadId} not found`);
		}

		// Calculate current scores and activity data
		await this.leadScoringService.calculateLeadScore(leadId);
		await this.leadScoringService.updateActivityData(leadId);

		// Refresh lead data with updated scores
		const updatedLead = await this.findOne(leadId);
		const currentScore = updatedLead.lead?.leadScore || 0;

		// Enhanced status progression logic with velocity awareness
		let shouldUpdateStatus = false;
		let newStatus = updatedLead.lead.status;
		let autoReason = '';

		// Get velocity metrics
		const daysSinceCreation = Math.floor(
			(new Date().getTime() - new Date(updatedLead.lead.createdAt).getTime()) / (24 * 60 * 60 * 1000),
		);
		const daysSinceUpdate = Math.floor(
			(new Date().getTime() - new Date(updatedLead.lead.updatedAt).getTime()) / (24 * 60 * 60 * 1000),
		);

		switch (updatedLead.lead.status) {
			case LeadStatus.PENDING:
				// High-scoring leads with good velocity should move to REVIEW
				if (currentScore >= 70 && daysSinceCreation <= 3) {
					newStatus = LeadStatus.REVIEW;
					autoReason = `High score (${currentScore}) with fast initial response`;
					shouldUpdateStatus = true;
				} else if (currentScore >= 80) {
					newStatus = LeadStatus.REVIEW;
					autoReason = `Exceptional score (${currentScore}) warrants review`;
					shouldUpdateStatus = true;
				}
				break;

			case LeadStatus.REVIEW:
				// Very high-scoring leads in review should be auto-approved if velocity is good
				if (currentScore >= 85 && daysSinceUpdate <= 2) {
					newStatus = LeadStatus.APPROVED;
					autoReason = `Exceptional score (${currentScore}) with fast progression`;
					shouldUpdateStatus = true;
				} else if (currentScore < 40 && daysSinceUpdate >= 7) {
					// Low-scoring leads stagnating in review should be declined
					newStatus = LeadStatus.DECLINED;
					autoReason = `Low score (${currentScore}) with slow progression`;
					shouldUpdateStatus = true;
				}
				break;

			case LeadStatus.APPROVED:
				// Approved leads with declining performance should be flagged for review
				if (currentScore < 30 && daysSinceUpdate >= 14) {
					newStatus = LeadStatus.REVIEW;
					autoReason = `Score degradation (${currentScore}) requires re-evaluation`;
					shouldUpdateStatus = true;
				}
				break;
		}

		// Apply status update if needed
		if (shouldUpdateStatus) {
			await this.updateLeadStatus(
				leadId,
				newStatus,
				autoReason,
				`Automated processing based on score ${currentScore} and velocity analysis`,
				this.getAutomatedNextStep(newStatus, currentScore),
			);

			this.logger.log(`Lead ${leadId} auto-processed: ${updatedLead.lead.status} → ${newStatus}. ${autoReason}`);
		} else {
			// Even if status doesn't change, update temperature based on current score
			await this.updateTemperatureBasedOnStatus(updatedLead.lead);
			await this.leadsRepository.save(updatedLead.lead);
		}

		return updatedLead.lead;
	}

	/**
	 * Get automated next step based on new status and score
	 */
	private getAutomatedNextStep(status: LeadStatus, score: number): string {
		switch (status) {
			case LeadStatus.REVIEW:
				return score >= 80
					? 'Priority review - consider for immediate approval'
					: 'Standard review process - validate lead quality';
			case LeadStatus.APPROVED:
				return score >= 85
					? 'Immediate outreach - high-priority prospect'
					: 'Schedule follow-up within 48 hours';
			case LeadStatus.DECLINED:
				return 'Lead declined due to low engagement - consider for nurture campaign';
			default:
				return 'Continue monitoring lead progress';
		}
	}

	/**
	 * Enhanced batch processing with velocity intelligence
	 */
	async batchProcessLeads(): Promise<void> {
		this.logger.log('Starting enhanced batch lead processing...');

		const leads = await this.leadsRepository.find({
			where: {
				isDeleted: false,
				status: In([LeadStatus.PENDING, LeadStatus.REVIEW, LeadStatus.APPROVED]),
			},
			order: { leadScore: 'DESC' }, // Process highest-scoring leads first
		});

		let processed = 0;
		for (const lead of leads) {
			try {
				await this.processLeadAutomatically(lead.uid);
				processed++;

				if (processed % 50 === 0) {
					this.logger.log(`Processed ${processed}/${leads.length} leads`);
				}
			} catch (error) {
				this.logger.error(`Failed to process lead ${lead.uid}: ${error.message}`);
			}
		}

		this.logger.log(`Completed batch processing. Processed ${processed}/${leads.length} leads.`);
	}
}
