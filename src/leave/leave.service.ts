import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { UpdateLeaveDto } from './dto/update-leave.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In, Not } from 'typeorm';
import { Leave } from './entities/leave.entity';
import { User } from '../user/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { LeaveStatus } from '../lib/enums/leave.enums';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { LeaveEmailService } from './services/leave-email.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalType, ApprovalPriority, ApprovalFlow, NotificationFrequency, ApprovalAction, ApprovalStatus } from '../lib/enums/approval.enums';

@Injectable()
export class LeaveService {
	private readonly logger = new Logger(LeaveService.name);
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'leave:';

	constructor(
		@InjectRepository(Leave)
		private leaveRepository: Repository<Leave>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly eventEmitter: EventEmitter2,
		private readonly leaveEmailService: LeaveEmailService,
		private readonly approvalsService: ApprovalsService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
		this.logger.debug(`LeaveService initialized with cache TTL: ${this.CACHE_TTL} minutes`);
	}

	private getCacheKey(key: string | number): string {
		const cacheKey = `${this.CACHE_PREFIX}${key}`;
		this.logger.debug(`Generated cache key: ${cacheKey}`);
		return cacheKey;
	}

	private async clearLeaveCache(leaveId?: number): Promise<void> {
		this.logger.debug(`Clearing leave cache${leaveId ? ` for leave ID: ${leaveId}` : ' (all leaves)'}`);
		
		try {
			// Get all cache keys
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// If specific leave, clear its cache
			if (leaveId) {
				keysToDelete.push(this.getCacheKey(leaveId));
			}

			// Clear all pagination and filtered leave list caches
			const leaveListCaches = keys.filter(
				(key) =>
					key.startsWith('leaves_page') || // Pagination caches
					key.startsWith('leave:all') || // All leaves cache
					key.includes('_limit'), // Filtered caches
			);
			keysToDelete.push(...leaveListCaches);

			// Clear all caches
			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
		} catch (error) {
			return error;
		}
	}

	async create(
		createLeaveDto: CreateLeaveDto,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string }> {
		this.logger.log(`Creating leave request for user: ${userId}, orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Leave request data: ${JSON.stringify({ ...createLeaveDto, startDate: createLeaveDto.startDate, endDate: createLeaveDto.endDate })}`);

		try {
			// Find the owner user
			if (!userId) {
				this.logger.error('User ID is required but not provided for leave request creation');
				throw new BadRequestException('User ID is required to create a leave request');
			}
			
			this.logger.debug(`Finding user with ID: ${userId}`);
			const owner = await this.userRepository.findOne({ where: { uid: userId } });

			if (!owner) {
				this.logger.error(`User not found with ID: ${userId}`);
				throw new NotFoundException(`User with ID ${userId} not found`);
			}
			this.logger.debug(`User found: ${owner.email} (${owner.name})`);

			this.logger.debug('Calculating leave duration and processing dates');

			// Format dates to YYYY-MM-DD string
			const formatDate = (date: Date | string): string | undefined => {
				if (!date) return undefined;
				const d = new Date(date);
				// Check if the date is valid after parsing
				if (isNaN(d.getTime())) {
					// Optionally throw an error or return undefined/original value
					// For now, returning undefined to let DB handle potential nulls if column allows
					// Or, if dates are mandatory, throw new BadRequestException(`Invalid date format: ${date}`);
					return undefined;
				}
				const year = d.getFullYear();
				const month = `0${d.getMonth() + 1}`.slice(-2);
				const day = `0${d.getDate()}`.slice(-2);
				return `${year}-${month}-${day}`;
			};

			const formattedStartDate = formatDate(createLeaveDto.startDate);
			const formattedEndDate = formatDate(createLeaveDto.endDate);

			// Calculate duration from start and end dates if not provided
			if (!createLeaveDto.duration) {
				this.logger.debug('Duration not provided, calculating from start and end dates');
				const startDate = new Date(createLeaveDto.startDate);
				const endDate = new Date(createLeaveDto.endDate);

				// Calculate business days between dates (excluding weekends)
				// This is a simplified version - in production, you'd want to account for holidays and partial days
				let duration = 0;
				let currentDate = new Date(startDate);

				while (currentDate <= endDate) {
					const dayOfWeek = currentDate.getDay();
					if (dayOfWeek !== 0 && dayOfWeek !== 6) {
						// Not Sunday (0) or Saturday (6)
						duration++;
					}
					currentDate.setDate(currentDate.getDate() + 1);
				}

				if (createLeaveDto.isHalfDay) {
					duration -= 0.5;
					this.logger.debug('Half-day leave detected, adjusting duration');
				}

				createLeaveDto.duration = duration;
				this.logger.debug(`Calculated leave duration: ${duration} days`);
			} else {
				this.logger.debug(`Using provided duration: ${createLeaveDto.duration} days`);
			}

			// Create new leave entity
			this.logger.debug('Creating leave entity with formatted dates and organization/branch associations');
			const leave = this.leaveRepository.create({
				...createLeaveDto,
				startDate: formattedStartDate as any, // TypeORM expects Date, but we provide string for 'date' type
				endDate: formattedEndDate as any, // TypeORM expects Date, but we provide string for 'date' type
				owner,
				status: LeaveStatus.PENDING,
				// Set organization and branch if provided
				...(orgId && { organisation: { uid: orgId } }),
				...(branchId && { branch: { uid: branchId } }),
			});

			// Save the leave request
			this.logger.debug('Saving leave request to database');
			const savedLeave = await this.leaveRepository.save(leave);
			this.logger.debug(`Leave request saved with ID: ${savedLeave.uid}`);

			// Check for leave conflicts and auto-reject if necessary
			this.logger.debug(`Checking for leave conflicts for leave ID: ${savedLeave.uid}`);
			const conflictCheck = await this.validateLeaveConflicts(savedLeave);
			if (conflictCheck.hasConflict) {
				this.logger.warn(`Auto-rejecting leave ${savedLeave.uid} due to conflicts with leaves: ${conflictCheck.conflictingLeaves.map(l => `#${l.uid}`).join(', ')}`);
				
				// Auto-reject the leave
				await this.leaveRepository.update(savedLeave.uid, {
					status: LeaveStatus.REJECTED,
					rejectedAt: new Date(),
					rejectionReason: `Automatically rejected due to conflicting leave requests on the same dates. Conflicting leaves: ${conflictCheck.conflictingLeaves.map(l => `#${l.uid}`).join(', ')}`,
				});

				this.logger.debug(`Sending rejection notification for auto-rejected leave: ${savedLeave.uid}`);
				// Send rejection notification
				const rejectedLeave = await this.leaveRepository.findOne({
					where: { uid: savedLeave.uid },
					relations: ['owner', 'organisation', 'branch'],
				});

				if (rejectedLeave) {
					await this.leaveEmailService.sendStatusUpdateToUser(
						rejectedLeave,
						owner,
						LeaveStatus.PENDING,
						null, // No specific user performed the rejection - system auto-rejection
					);
					this.logger.debug(`Rejection notification sent successfully for leave: ${savedLeave.uid}`);
				}

				// Clear cache and return
				await this.clearLeaveCache();
				this.logger.log(`Leave request ${savedLeave.uid} created but automatically rejected due to conflicts`);
				return { message: 'Leave request created but automatically rejected due to conflicting dates' };
			}
			this.logger.debug(`No conflicts found for leave ID: ${savedLeave.uid}`);

			// Initialize approval workflow chain for the leave request
			this.logger.debug(`Initializing approval workflow for leave: ${savedLeave.uid}`);
			await this.initializeLeaveApprovalWorkflow(savedLeave, owner);

			// Send confirmation email to applicant
			this.logger.debug(`Sending confirmation email to applicant: ${owner.email}`);
			await this.leaveEmailService.sendApplicationConfirmation(savedLeave, owner);

			// Send notification email to admins
			this.logger.debug('Sending admin notification emails');
			await this.leaveEmailService.sendNewApplicationAdminNotification(savedLeave, owner);

			// Emit leave created event for notifications
			this.logger.debug(`Emitting leave.created event for leave: ${savedLeave.uid}`);
			this.eventEmitter.emit('leave.created', {
				leave: savedLeave,
				owner,
			});

			// Clear cache
			await this.clearLeaveCache();

			this.logger.log(`Leave request created successfully for user: ${userId}, leave ID: ${savedLeave.uid}`);
			return { message: 'Leave request created successfully' };
		} catch (error) {
			this.logger.error(`Failed to create leave request for user: ${userId}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException(error.message || 'Error creating leave request');
		}
	}

	async findAll(
		filters?: {
			status?: string;
			leaveType?: string;
			ownerUid?: number;
			startDate?: Date;
			endDate?: Date;
			isApproved?: boolean;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<PaginatedResponse<Leave>> {
		try {
			// Building the where clause
			const where: any = {};

			// Add organizational filters
			if (orgId) {
				where.organisation = { uid: orgId };
			}

			if (branchId) {
				where.branch = { uid: branchId };
			}

			// Add status filter
			if (filters?.status) {
				where.status = filters.status;
			}

			// Add leave type filter
			if (filters?.leaveType) {
				where.leaveType = filters.leaveType;
			}

			// Add approval status filter
			if (filters?.isApproved !== undefined) {
				where.status = filters.isApproved ? LeaveStatus.APPROVED : LeaveStatus.PENDING;
			}

			// Add date range filters
			if (filters?.startDate && filters?.endDate) {
				// Match leaves that overlap with the date range
				where.startDate = LessThanOrEqual(filters.endDate);
				where.endDate = MoreThanOrEqual(filters.startDate);
			} else if (filters?.startDate) {
				where.startDate = MoreThanOrEqual(filters.startDate);
			} else if (filters?.endDate) {
				where.endDate = LessThanOrEqual(filters.endDate);
			}

			// Calculate pagination
			const skip = (page - 1) * limit;

			// Execute query with pagination
			const [data, total] = await this.leaveRepository.findAndCount({
				where,
				skip,
				take: limit,
				relations: ['owner', 'organisation', 'branch', 'approvedBy'],
				order: {
					createdAt: 'DESC',
				},
			});

			// Calculate total pages
			const totalPages = Math.ceil(total / limit);

			return {
				data,
				meta: {
					total,
					page,
					limit,
					totalPages,
				},
				message: 'Success',
			};
		} catch (error) {
			throw new BadRequestException(error.message || 'Error retrieving leave requests');
		}
	}

	async findOne(
		ref: number,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string; leave: Leave | null }> {
		try {
			// Build query conditions
			const where: any = { uid: ref };

			// Add org and branch filters if provided
			if (orgId) {
				where.organisation = { uid: orgId };
			}

			if (branchId) {
				where.branch = { uid: branchId };
			}

			// Try to get from cache first
			const cacheKey = this.getCacheKey(`${ref}_${orgId || 'null'}_${branchId || 'null'}`);
			const cached = await this.cacheManager.get(cacheKey);

			if (cached) {
				return {
					leave: cached as Leave,
					message: 'Success',
				};
			}

			// If not cached, query the database
			const leave = await this.leaveRepository.findOne({
				where,
				relations: ['owner', 'organisation', 'branch', 'approvedBy'],
			});

			if (!leave) {
				return {
					leave: null,
					message: 'Leave request not found',
				};
			}

			// Cache the result
			await this.cacheManager.set(cacheKey, leave, this.CACHE_TTL);

			return {
				leave,
				message: 'Success',
			};
		} catch (error) {
			throw new BadRequestException(error.message || 'Error retrieving leave request');
		}
	}

	async leavesByUser(
		ref: number,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string; leaves: Leave[] }> {
		try {
			// Build query conditions
			const where: any = { owner: { uid: ref } };

			// Add org and branch filters if provided
			if (orgId) {
				where.organisation = { uid: orgId };
			}

			if (branchId) {
				where.branch = { uid: branchId };
			}

			// Query leaves for the user
			const leaves = await this.leaveRepository.find({
				where,
				relations: ['owner', 'organisation', 'branch', 'approvedBy'],
				order: {
					startDate: 'DESC',
				},
			});

			return {
				leaves,
				message: 'Success',
			};
		} catch (error) {
			throw new BadRequestException(error.message || 'Error retrieving user leave requests');
		}
	}

	async update(
		ref: number,
		updateLeaveDto: UpdateLeaveDto,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string }> {
		try {
			// Find the leave first
			const { leave } = await this.findOne(ref, orgId, branchId, userId);

			if (!leave) {
				throw new NotFoundException('Leave request not found');
			}

			// Check if leave can be updated (only pending leaves can be updated)
			if (leave.status !== LeaveStatus.PENDING) {
				throw new BadRequestException(
					`Leave request cannot be updated because it is already ${leave.status.toLowerCase()}`,
				);
			}

			// Calculate duration if start or end date changes
			if ((updateLeaveDto.startDate || updateLeaveDto.endDate) && !updateLeaveDto.duration) {
				const startDate = new Date(updateLeaveDto.startDate || leave.startDate);
				const endDate = new Date(updateLeaveDto.endDate || leave.endDate);

				// Calculate business days between dates (excluding weekends)
				let duration = 0;
				let currentDate = new Date(startDate);

				while (currentDate <= endDate) {
					const dayOfWeek = currentDate.getDay();
					if (dayOfWeek !== 0 && dayOfWeek !== 6) {
						// Not Sunday (0) or Saturday (6)
						duration++;
					}
					currentDate.setDate(currentDate.getDate() + 1);
				}

				if (updateLeaveDto.isHalfDay !== undefined ? updateLeaveDto.isHalfDay : leave.isHalfDay) {
					duration -= 0.5;
				}

				updateLeaveDto.duration = duration;
			}

			// Handle modifications during approval process
			await this.handleLeaveModificationDuringApproval(leave, updateLeaveDto);

			// Update the leave
			await this.leaveRepository.update(ref, {
				...updateLeaveDto,
			});

			// Get updated leave for further processing
			const updatedLeave = await this.leaveRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'organisation', 'branch'],
			});

			// If critical fields were modified and leave is back to pending, reinitialize approval workflow
			const criticalFieldsModified = 
				(updateLeaveDto.startDate && updateLeaveDto.startDate !== leave.startDate) ||
				(updateLeaveDto.endDate && updateLeaveDto.endDate !== leave.endDate) ||
				(updateLeaveDto.leaveType && updateLeaveDto.leaveType !== leave.leaveType) ||
				(updateLeaveDto.duration && updateLeaveDto.duration !== leave.duration);

			if (criticalFieldsModified && updatedLeave && updatedLeave.status === LeaveStatus.PENDING) {
				this.logger.log(`🔄 [LeaveService] Reinitializing approval workflow for modified leave ${ref}`);
				await this.initializeLeaveApprovalWorkflow(updatedLeave, updatedLeave.owner);
			}

			// Clear cache
			await this.clearLeaveCache(ref);

			return { message: 'Leave request updated successfully' };
		} catch (error) {
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException(error.message || 'Error updating leave request');
		}
	}

	async approveLeave(
		ref: number,
		approverUid: number,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string }> {
		try {
			// Find the leave first
			const { leave } = await this.findOne(ref, orgId, branchId, userId);

			if (!leave) {
				throw new NotFoundException('Leave request not found');
			}

			// Check if leave can be approved (only pending leaves can be approved)
			if (leave.status !== LeaveStatus.PENDING) {
				throw new BadRequestException(
					`Leave request cannot be approved because it is already ${leave.status.toLowerCase()}`,
				);
			}

			// Find the approver
			const approver = await this.userRepository.findOne({ where: { uid: approverUid } });

			if (!approver) {
				throw new NotFoundException(`Approver with ID ${approverUid} not found`);
			}

			// Store previous status for email
			const previousStatus = leave.status;

			// Update the leave
			await this.leaveRepository.update(ref, {
				status: LeaveStatus.APPROVED,
				approvedBy: approver,
				approvedAt: new Date(),
			});

			// Get updated leave with relations
			const updatedLeave = await this.leaveRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'approvedBy', 'organisation', 'branch'],
			});

			if (updatedLeave && updatedLeave.owner) {
				// Send status update emails
				await this.leaveEmailService.sendStatusUpdateToUser(
					updatedLeave,
					updatedLeave.owner,
					previousStatus,
					approver
				);
				await this.leaveEmailService.sendStatusUpdateToAdmins(
					updatedLeave,
					updatedLeave.owner,
					previousStatus,
					approver
				);
			}

			// Emit leave approved event for notifications
			this.eventEmitter.emit('leave.approved', {
				leave: updatedLeave,
				approver,
			});

			// Clear cache
			await this.clearLeaveCache(ref);

			return { message: 'Leave request approved successfully' };
		} catch (error) {
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException(error.message || 'Error approving leave request');
		}
	}

	async rejectLeave(
		ref: number,
		rejectionReason: string,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string }> {
		try {
			// Find the leave first
			const { leave } = await this.findOne(ref, orgId, branchId, userId);

			if (!leave) {
				throw new NotFoundException('Leave request not found');
			}

			// Check if leave can be rejected (only pending leaves can be rejected)
			if (leave.status !== LeaveStatus.PENDING) {
				throw new BadRequestException(
					`Leave request cannot be rejected because it is already ${leave.status.toLowerCase()}`,
				);
			}

			// Validate rejection reason
			if (!rejectionReason) {
				throw new BadRequestException('Rejection reason is required');
			}

			// Store previous status for email
			const previousStatus = leave.status;

			// Update the leave
			await this.leaveRepository.update(ref, {
				status: LeaveStatus.REJECTED,
				rejectedAt: new Date(),
				rejectionReason,
			});

			// Get updated leave with relations
			const updatedLeave = await this.leaveRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'approvedBy', 'organisation', 'branch'],
			});

			if (updatedLeave && updatedLeave.owner) {
				// Send status update emails
				await this.leaveEmailService.sendStatusUpdateToUser(
					updatedLeave,
					updatedLeave.owner,
					previousStatus
				);
				await this.leaveEmailService.sendStatusUpdateToAdmins(
					updatedLeave,
					updatedLeave.owner,
					previousStatus
				);
			}

			// Emit leave rejected event for notifications
			this.eventEmitter.emit('leave.rejected', {
				leave: updatedLeave,
				rejectionReason,
			});

			// Clear cache
			await this.clearLeaveCache(ref);

			return { message: 'Leave request rejected successfully' };
		} catch (error) {
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException(error.message || 'Error rejecting leave request');
		}
	}

	async cancelLeave(
		ref: number,
		cancellationReason: string,
		userId: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		try {
			// Find the leave first
			const { leave } = await this.findOne(ref, orgId, branchId, userId);

			if (!leave) {
				throw new NotFoundException('Leave request not found');
			}

			// Check if leave can be canceled (only pending or approved leaves can be canceled)
			if (![LeaveStatus.PENDING, LeaveStatus.APPROVED].includes(leave.status)) {
				throw new BadRequestException(
					`Leave request cannot be canceled because it is already ${leave.status.toLowerCase()}`,
				);
			}

			// Validate cancellation reason
			if (!cancellationReason) {
				throw new BadRequestException('Cancellation reason is required');
			}

			// Check if the user canceling is the owner or has admin privileges
			// This check would be more robust in a real application
			const isOwner = leave.owner?.uid === userId;
			// We're assuming here that non-owners are authorized through the controller's @Roles decorator

			// Determine which cancellation status to use
			const cancellationStatus = isOwner ? LeaveStatus.CANCELLED_BY_USER : LeaveStatus.CANCELLED_BY_ADMIN;

			// Handle approval workflow cancellation before updating leave status
			await this.handleLeaveRevocation(leave, userId, cancellationReason);

			// Update the leave
			await this.leaveRepository.update(ref, {
				status: cancellationStatus,
				cancelledAt: new Date(),
				cancellationReason,
			});

			// Emit leave canceled event for notifications
			this.eventEmitter.emit('leave.canceled', {
				leave,
				cancellationReason,
				canceledBy: userId,
			});

			// Clear cache
			await this.clearLeaveCache(ref);

			return { message: 'Leave request canceled successfully' };
		} catch (error) {
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException(error.message || 'Error canceling leave request');
		}
	}

	async remove(ref: number, orgId?: number, branchId?: number, userId?: number): Promise<{ message: string }> {
		try {
			// Find the leave first
			const { leave } = await this.findOne(ref, orgId, branchId, userId);

			if (!leave) {
				throw new NotFoundException('Leave request not found');
			}

			// Soft delete the leave
			await this.leaveRepository.softDelete(ref);

			// Clear cache
			await this.clearLeaveCache(ref);

			return { message: 'Leave request deleted successfully' };
		} catch (error) {
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException(error.message || 'Error deleting leave request');
		}
	}

	/**
	 * Initialize approval workflow chain for leave requests
	 * Creates an approval request that integrates with the approval system
	 */
	private async initializeLeaveApprovalWorkflow(leave: Leave, requester: User): Promise<void> {
		try {
			this.logger.log(`🔄 [LeaveService] Initializing approval workflow for leave ${leave.uid}`);

			// Determine approval priority based on leave type and duration
			let priority = ApprovalPriority.MEDIUM;
			if (leave.duration > 14) { // Extended leave (> 2 weeks)
				priority = ApprovalPriority.HIGH;
			} else if (leave.leaveType === 'SICK' && leave.duration > 3) { // Extended sick leave
				priority = ApprovalPriority.HIGH;
			} else if (leave.duration <= 1) { // Single day leave
				priority = ApprovalPriority.LOW;
			}

			// Create approval request
			const approvalDto = {
				title: `Leave Request - ${leave.leaveType} (${leave.duration} day${leave.duration > 1 ? 's' : ''})`,
				description: `${requester.name || requester.email} has requested ${leave.leaveType} leave from ${leave.startDate} to ${leave.endDate}. ${leave.motivation ? 'Reason: ' + leave.motivation : ''}`,
				type: ApprovalType.LEAVE_REQUEST,
				priority: priority,
				flowType: ApprovalFlow.SEQUENTIAL, // Sequential approval for leave requests
				entityId: leave.uid, // Should be number, not string
				entityType: 'leave',
				amount: undefined, // No monetary amount for leave requests
				currency: undefined,
				deadline: this.calculateApprovalDeadline(leave.startDate).toISOString(), // ISO string format
				requiresSignature: false, // Most leave requests don't require digital signature
				isUrgent: leave.startDate <= this.addDaysToDate(new Date(), 2), // Urgent if starting within 2 days
				notificationFrequency: NotificationFrequency.IMMEDIATE,
				emailNotificationsEnabled: true,
				pushNotificationsEnabled: true,
				organisationRef: requester.organisationRef,
				branchUid: requester.branch?.uid,
				metadata: {
					leaveId: leave.uid,
					leaveType: leave.leaveType,
					startDate: leave.startDate,
					endDate: leave.endDate,
					duration: leave.duration,
					isHalfDay: leave.isHalfDay,
					halfDayPeriod: leave.halfDayPeriod,
					requesterName: requester.name,
					requesterEmail: requester.email,
					branchName: leave.branch?.name,
					departmentId: requester.departmentId,
				},
				customFields: {
					tags: ['leave-request', leave.leaveType.toLowerCase(), ...(leave.tags || [])],
				},
			};

			// Create the approval using the approvals service
			const approval = await this.approvalsService.create(approvalDto, {
				user: requester,
				organisationRef: requester.organisationRef,
				branchUid: requester.branch?.uid,
			} as any);

			this.logger.log(`✅ [LeaveService] Approval workflow initialized: approval ${approval.uid} for leave ${leave.uid}`);

		} catch (error) {
			this.logger.error(`❌ [LeaveService] Error initializing approval workflow for leave ${leave.uid}:`, error.message);
			// Don't throw error - leave creation should succeed even if approval workflow fails
			// This ensures backwards compatibility and system resilience
		}
	}

	/**
	 * Calculate appropriate deadline for approval based on leave start date
	 * Ensures sufficient time for approval process
	 */
	private calculateApprovalDeadline(leaveStartDate: Date): Date {
		const startDate = new Date(leaveStartDate);
		const now = new Date();
		
		// Calculate days between now and leave start
		const daysDifference = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		
		if (daysDifference <= 1) {
			// Same day or next day - urgent approval needed within 4 hours
			return new Date(now.getTime() + (4 * 60 * 60 * 1000));
		} else if (daysDifference <= 3) {
			// Within 3 days - approve by end of next business day
			const deadline = new Date(now);
			deadline.setDate(deadline.getDate() + 1);
			deadline.setHours(17, 0, 0, 0); // 5 PM next day
			return deadline;
		} else {
			// More than 3 days - approve at least 2 days before leave starts
			const deadline = new Date(startDate);
			deadline.setDate(deadline.getDate() - 2);
			deadline.setHours(17, 0, 0, 0); // 5 PM, 2 days before
			return deadline;
		}
	}

	/**
	 * Utility method to add days to a date
	 */
	private addDaysToDate(date: Date, days: number): Date {
		const result = new Date(date);
		result.setDate(result.getDate() + days);
		return result;
	}

	/**
	 * Handle leave revocation by canceling associated approval workflows
	 * Notifies all approvers that the leave request has been withdrawn
	 */
	private async handleLeaveRevocation(leave: Leave, userId: number, cancellationReason: string): Promise<void> {
		try {
			this.logger.log(`🔄 [LeaveService] Handling leave revocation for leave ${leave.uid}`);

			// Find any active approval workflows for this leave
			const activeApprovals = await this.approvalsService.findAll({
				entityType: 'leave',
				entityId: leave.uid,
				status: [ApprovalStatus.PENDING, ApprovalStatus.SUBMITTED, ApprovalStatus.UNDER_REVIEW],
			} as any, { uid: userId } as any);

			if (activeApprovals && activeApprovals.data && activeApprovals.data.length > 0) {
				this.logger.log(`📋 [LeaveService] Found ${activeApprovals.data.length} active approval(s) for leave ${leave.uid}`);
				
				for (const approval of activeApprovals.data) {
					try {
						// Withdraw the approval workflow
						await this.approvalsService.performAction(approval.uid, {
							action: ApprovalAction.WITHDRAW,
							reason: `Leave request cancelled by user. Reason: ${cancellationReason}`,
							comments: `The associated leave request has been cancelled by ${userId === leave.owner?.uid ? 'the requester' : 'an administrator'}.`,
						}, { uid: userId } as any);

						this.logger.log(`✅ [LeaveService] Approval ${approval.uid} withdrawn for cancelled leave ${leave.uid}`);
					} catch (error) {
						this.logger.error(`❌ [LeaveService] Error withdrawing approval ${approval.uid}:`, error.message);
						// Continue with other approvals even if one fails
					}
				}
			} else {
				this.logger.log(`ℹ️ [LeaveService] No active approvals found for leave ${leave.uid}`);
			}

		} catch (error) {
			this.logger.error(`❌ [LeaveService] Error handling leave revocation for leave ${leave.uid}:`, error.message);
			// Don't throw error - leave cancellation should succeed even if approval withdrawal fails
		}
	}

	/**
	 * Validate leave conflicts and auto-reject if necessary
	 * Checks for overlapping leave requests for the same user
	 */
	private async validateLeaveConflicts(leave: Leave): Promise<{ hasConflict: boolean; conflictingLeaves: Leave[] }> {
		try {
			this.logger.log(`🔍 [LeaveService] Checking for leave conflicts for user ${leave.owner?.uid}`);

			const conflictingLeaves = await this.leaveRepository.find({
				where: {
					owner: { uid: leave.owner?.uid },
					status: In([LeaveStatus.APPROVED, LeaveStatus.TAKEN, LeaveStatus.PARTIALLY_TAKEN]),
					uid: Not(leave.uid), // Exclude the current leave
				},
				relations: ['owner'],
			});

			const hasConflict = conflictingLeaves.some(existingLeave => {
				const newStart = new Date(leave.startDate);
				const newEnd = new Date(leave.endDate);
				const existingStart = new Date(existingLeave.startDate);
				const existingEnd = new Date(existingLeave.endDate);

				// Check for date overlap
				return (newStart <= existingEnd) && (newEnd >= existingStart);
			});

			this.logger.log(`${hasConflict ? '⚠️' : '✅'} [LeaveService] Leave conflict check complete: ${hasConflict ? 'CONFLICT FOUND' : 'NO CONFLICTS'}`);

			return {
				hasConflict,
				conflictingLeaves: hasConflict ? conflictingLeaves.filter(existingLeave => {
					const newStart = new Date(leave.startDate);
					const newEnd = new Date(leave.endDate);
					const existingStart = new Date(existingLeave.startDate);
					const existingEnd = new Date(existingLeave.endDate);
					return (newStart <= existingEnd) && (newEnd >= existingStart);
				}) : [],
			};

		} catch (error) {
			this.logger.error(`❌ [LeaveService] Error checking leave conflicts:`, error.message);
			return { hasConflict: false, conflictingLeaves: [] };
		}
	}

	/**
	 * Handle leave modification during approval process
	 * Cancels existing approval and creates new one if leave is modified while pending approval
	 */
	private async handleLeaveModificationDuringApproval(leave: Leave, updateData: Partial<Leave>): Promise<void> {
		try {
			// Check if critical leave details are being modified
			const criticalFieldsModified = 
				(updateData.startDate && updateData.startDate !== leave.startDate) ||
				(updateData.endDate && updateData.endDate !== leave.endDate) ||
				(updateData.leaveType && updateData.leaveType !== leave.leaveType) ||
				(updateData.duration && updateData.duration !== leave.duration);

			if (!criticalFieldsModified) {
				return; // No critical changes, no need to restart approval
			}

			this.logger.log(`🔄 [LeaveService] Critical fields modified for leave ${leave.uid}, restarting approval process`);

			// Cancel existing approval workflows
			await this.handleLeaveRevocation(leave, leave.owner?.uid || 0, 'Leave details modified, restarting approval process');

			// Set leave back to pending status
			await this.leaveRepository.update(leave.uid, { 
				status: LeaveStatus.PENDING,
				approvedBy: null,
				approvedAt: null,
				rejectedAt: null,
				rejectionReason: null,
			});

			// The approval workflow will be restarted by the update method calling initializeLeaveApprovalWorkflow

		} catch (error) {
			this.logger.error(`❌ [LeaveService] Error handling leave modification during approval:`, error.message);
		}
	}

	/**
	 * Event listener for approval workflow actions
	 * Updates leave status based on approval decisions
	 */
	@OnEvent('approval.action.performed')
	async handleApprovalAction(payload: any): Promise<void> {
		try {
			this.logger.log(`🔄 [LeaveService] Handling approval action: ${payload.action} for approval ${payload.approvalId}`);

			// Check if this approval is for a leave request
			if (payload.type !== ApprovalType.LEAVE_REQUEST) {
				return; // Not a leave request, ignore
			}

			// Get the user who performed the action for approval lookup
			const actionUser = await this.userRepository.findOne({
				where: { uid: payload.actionBy },
			});

			if (!actionUser) {
				this.logger.error(`❌ [LeaveService] Action user ${payload.actionBy} not found for approval ${payload.approvalId}`);
				return;
			}

			// Find the approval to get the entity information
			const approval = await this.approvalsService.findOne(payload.approvalId, actionUser as any);
			if (!approval || approval.entityType !== 'leave') {
				this.logger.log(`⚠️ [LeaveService] Approval ${payload.approvalId} is not for a leave request`);
				return;
			}

			// Find the corresponding leave request
			const leave = await this.leaveRepository.findOne({
				where: { uid: approval.entityId },
				relations: ['owner', 'organisation', 'branch'],
			});

			if (!leave) {
				this.logger.error(`❌ [LeaveService] Leave request ${approval.entityId} not found for approval ${payload.approvalId}`);
				return;
			}

			// actionUser already retrieved above for approval lookup

			const previousStatus = leave.status;
			let newStatus: LeaveStatus;
			let updateFields: Partial<Leave> = {};

			// Handle different approval actions
			switch (payload.action) {
				case ApprovalAction.APPROVE:
					if (payload.toStatus === ApprovalStatus.APPROVED) {
						newStatus = LeaveStatus.APPROVED;
						updateFields = {
							status: newStatus,
							approvedBy: actionUser,
							approvedAt: new Date(),
							comments: payload.comments || 'Approved via approval workflow',
						};
						this.logger.log(`✅ [LeaveService] Leave ${leave.uid} approved by ${actionUser?.email || payload.actionBy}`);
					}
					break;

				case ApprovalAction.REJECT:
					newStatus = LeaveStatus.REJECTED;
					updateFields = {
						status: newStatus,
						rejectedAt: new Date(),
						rejectionReason: payload.reason || payload.comments || 'Rejected via approval workflow',
					};
					this.logger.log(`❌ [LeaveService] Leave ${leave.uid} rejected by ${actionUser?.email || payload.actionBy}`);
					break;

				case ApprovalAction.CANCEL:
				case ApprovalAction.WITHDRAW:
					newStatus = LeaveStatus.CANCELLED_BY_USER;
					updateFields = {
						status: newStatus,
						cancelledAt: new Date(),
						cancellationReason: payload.reason || payload.comments || 'Cancelled via approval workflow',
					};
					this.logger.log(`🚫 [LeaveService] Leave ${leave.uid} cancelled/withdrawn`);
					break;

				default:
					// For other actions like REQUEST_INFO, DELEGATE, ESCALATE, don't change leave status
					this.logger.log(`ℹ️ [LeaveService] No leave status change needed for action: ${payload.action}`);
					return;
			}

			// Update the leave request if status should change
			if (newStatus && newStatus !== previousStatus) {
				await this.leaveRepository.update(leave.uid, updateFields);
				
				// Reload the leave with updated data
				const updatedLeave = await this.leaveRepository.findOne({
					where: { uid: leave.uid },
					relations: ['owner', 'organisation', 'branch', 'approvedBy'],
				});

				if (updatedLeave) {
					// Send status update emails
					await this.leaveEmailService.sendStatusUpdateToUser(
						updatedLeave,
						leave.owner,
						previousStatus,
						actionUser,
					);

					await this.leaveEmailService.sendStatusUpdateToAdmins(
						updatedLeave,
						leave.owner,
						previousStatus,
						actionUser,
					);

					// Emit leave status updated event
					this.eventEmitter.emit('leave.status.updated', {
						leave: updatedLeave,
						previousStatus,
						newStatus,
						updatedBy: actionUser,
						approvalId: payload.approvalId,
						approvalAction: payload.action,
					});

					// Clear cache
					await this.clearLeaveCache(leave.uid);

					this.logger.log(`✅ [LeaveService] Leave ${leave.uid} status updated from ${previousStatus} to ${newStatus}`);
				}
			}

		} catch (error) {
			this.logger.error(`❌ [LeaveService] Error handling approval action:`, error.message);
			// Don't throw error - this is an event listener and should not break the approval workflow
		}
	}
}
