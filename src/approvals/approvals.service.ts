import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, Between, SelectQueryBuilder } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { UpdateApprovalDto } from './dto/update-approval.dto';
import { ApprovalActionDto, SignApprovalDto, BulkApprovalActionDto } from './dto/approval-action.dto';
import { ApprovalQueryDto } from './dto/approval-query.dto';
import { Approval } from './entities/approval.entity';
import { ApprovalHistory } from './entities/approval-history.entity';
import { ApprovalSignature } from './entities/approval-signature.entity';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationPriority, NotificationEvent } from '../lib/types/unified-notification.types';
import { 
    ApprovalStatus, 
    ApprovalAction, 
    ApprovalType,
    ApprovalPriority,
    ApprovalFlow 
} from '../lib/enums/approval.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { GeneralStatus } from '../lib/enums/status.enums';
import { EmailType } from '../lib/enums/email.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';

// Type alias for the user from authenticated request
type RequestUser = AuthenticatedRequest['user'];

@Injectable()
export class ApprovalsService {
    private readonly logger = new Logger(ApprovalsService.name);
    private readonly CACHE_PREFIX = 'approvals:';
    private readonly CACHE_TTL: number;

    constructor(
        @InjectRepository(Approval)
        private readonly approvalRepository: Repository<Approval>,
        @InjectRepository(ApprovalHistory)
        private readonly historyRepository: Repository<ApprovalHistory>,
        @InjectRepository(ApprovalSignature)
        private readonly signatureRepository: Repository<ApprovalSignature>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Organisation)
        private readonly organisationRepository: Repository<Organisation>,
        @InjectRepository(Branch)
        private readonly branchRepository: Repository<Branch>,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService,
        private readonly unifiedNotificationService: UnifiedNotificationService
    ) {
        this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 300000; // 5 minutes default
        this.logger.log(`🚀 [ApprovalsService] Initialized with cache TTL: ${this.CACHE_TTL}ms`);
    }

    /**
     * 🔑 Generate cache key with consistent prefix
     * @param key - The key identifier
     * @returns Formatted cache key with prefix
     */
    private getCacheKey(key: string | number): string {
        return `${this.CACHE_PREFIX}${key}`;
    }

    /**
     * 📱 Send push notifications for approval events
     * @param approval - Approval entity
     * @param event - Notification event type
     * @param recipientUserIds - User IDs to send notifications to
     * @param extraData - Additional data for the notification
     */
    private async sendApprovalPushNotification(
        approval: Approval,
        event: string,
        recipientUserIds: number[],
        extraData?: Record<string, any>
    ): Promise<void> {
        if (!recipientUserIds || recipientUserIds.length === 0) {
            return;
        }

        try {
            this.logger.debug(`📱 [sendApprovalPushNotification] Sending ${event} notification for approval ${approval.uid} to ${recipientUserIds.length} users`);

            // Map approval event to notification priority
            let priority = NotificationPriority.NORMAL;
            switch (event) {
                case 'APPROVAL_CREATED':
                case 'APPROVAL_SUBMITTED':
                    priority = approval.isUrgent || approval.priority === ApprovalPriority.URGENT || approval.priority === ApprovalPriority.CRITICAL 
                        ? NotificationPriority.HIGH 
                        : NotificationPriority.NORMAL;
                    break;
                case 'APPROVAL_APPROVED':
                case 'APPROVAL_REJECTED':
                case 'APPROVAL_ESCALATED':
                    priority = NotificationPriority.HIGH;
                    break;
                case 'APPROVAL_INFO_REQUESTED':
                    priority = NotificationPriority.HIGH;
                    break;
                default:
                    priority = NotificationPriority.NORMAL;
            }

            // Prepare notification data
            const notificationData = {
                approvalId: approval.uid,
                approvalReference: approval.approvalReference,
                title: approval.title,
                type: approval.type,
                status: approval.status,
                priority: approval.priority,
                amount: approval.amount,
                currency: approval.currency,
                deadline: approval.deadline?.toISOString(),
                isUrgent: approval.isUrgent,
                requesterName: '', // Will be populated by the notification service
                approverName: '',
                ...extraData,
            };

            await this.unifiedNotificationService.sendTemplatedNotification(
                event as NotificationEvent,
                recipientUserIds,
                notificationData,
                {
                    priority,
                    customData: {
                        type: 'approval',
                        approvalId: approval.uid,
                        approvalReference: approval.approvalReference,
                        status: approval.status,
                    },
                }
            );

            this.logger.debug(`✅ [sendApprovalPushNotification] ${event} notification sent for approval ${approval.uid}`);
        } catch (error) {
            this.logger.error(`❌ [sendApprovalPushNotification] Failed to send ${event} notification for approval ${approval.uid}:`, error.message);
            // Don't throw error - notifications are non-critical
        }
    }

    /**
     * 🗑️ Comprehensive cache invalidation for approval-related data
     * Clears all relevant cache entries when approval data changes
     * @param approval - Approval entity to invalidate cache for
     */
    private async invalidateApprovalCache(approval: Approval): Promise<void> {
        try {
            this.logger.debug(`🗑️ [invalidateApprovalCache] Invalidating cache for approval: ${approval.uid}`);

            // Get all cache keys
            const keys = await this.cacheManager.store.keys();

            // Keys to clear
            const keysToDelete = [];

            // Add approval-specific keys
            keysToDelete.push(
                this.getCacheKey(approval.uid),
                this.getCacheKey(`ref_${approval.approvalReference}`),
                `${this.CACHE_PREFIX}all`,
                `${this.CACHE_PREFIX}stats`,
                `${this.CACHE_PREFIX}pending`,
            );

            // Add requester-specific keys
            if (approval.requesterUid) {
                keysToDelete.push(
                    this.getCacheKey(`user_${approval.requesterUid}_requests`),
                    this.getCacheKey(`user_${approval.requesterUid}_pending`),
                );
            }

            // Add approver-specific keys
            if (approval.approverUid) {
                keysToDelete.push(
                    this.getCacheKey(`user_${approval.approverUid}_pending`),
                    this.getCacheKey(`user_${approval.approverUid}_approvals`),
                );
            }

            // Add organization-specific keys
            if (approval.organisationRef) {
                keysToDelete.push(
                    this.getCacheKey(`org_${approval.organisationRef}`),
                    this.getCacheKey(`org_${approval.organisationRef}_stats`),
                );
            }

            // Add branch-specific keys
            if (approval.branchUid) {
                keysToDelete.push(
                    this.getCacheKey(`branch_${approval.branchUid}`),
                    this.getCacheKey(`branch_${approval.branchUid}_stats`),
                );
            }

            // Add type and status-specific keys
            keysToDelete.push(
                this.getCacheKey(`type_${approval.type}`),
                this.getCacheKey(`status_${approval.status}`),
                this.getCacheKey(`priority_${approval.priority}`),
            );

            // Clear all pagination and filtered approval list caches
            const approvalListCaches = keys.filter(
                (key) =>
                    key.startsWith(`${this.CACHE_PREFIX}page`) ||
                    key.startsWith(`${this.CACHE_PREFIX}search`) ||
                    key.includes('_limit') ||
                    key.includes('_filter'),
            );
            keysToDelete.push(...approvalListCaches);

            // Clear all caches
            await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));

            this.logger.debug(`✅ [invalidateApprovalCache] Cache invalidated for approval ${approval.uid}. Cleared ${keysToDelete.length} cache keys`);

            // Emit event for other services that might be caching approval data
            this.eventEmitter.emit('approvals.cache.invalidate', {
                approvalId: approval.uid,
                keys: keysToDelete,
            });
        } catch (error) {
            this.logger.error(`❌ [invalidateApprovalCache] Error invalidating approval cache for approval ${approval.uid}:`, error.message);
        }
    }

    /**
     * 🎯 Smart approval routing based on type, amount, and organizational hierarchy
     * @param approvalType - Type of approval request
     * @param amount - Monetary amount (if applicable)
     * @param requester - User requesting approval
     * @returns Array of potential approvers with their priority order
     */
    private async getApprovalRouting(
        approvalType: ApprovalType,
        amount: number | null,
        requester: User,
    ): Promise<{ approver: User; priority: number; reason: string }[]> {
        this.logger.log(`🎯 [getApprovalRouting] Determining approval routing for type: ${approvalType}, amount: ${amount}, requester: ${requester.uid}`);

        try {
            const approvers: { approver: User; priority: number; reason: string }[] = [];

            // HR-specific routing for leave and HR-related requests
            if ([
                ApprovalType.LEAVE_REQUEST, 
                ApprovalType.OVERTIME, 
                ApprovalType.EXPENSE_CLAIM, 
                ApprovalType.REIMBURSEMENT, 
                ApprovalType.TRAVEL_REQUEST,
                ApprovalType.ROLE_CHANGE,
                ApprovalType.DEPARTMENT_TRANSFER
            ].includes(approvalType)) {
                this.logger.debug(`👥 [getApprovalRouting] HR routing for type: ${approvalType}`);
                const hrUsers = await this.getHRUsers(requester.organisationRef);
                hrUsers.forEach((hrUser, index) => {
                    approvers.push({
                        approver: hrUser,
                        priority: index + 1,
                        reason: `HR approval required for ${approvalType}`,
                    });
                });
            }

            // Amount-based routing for financial approvals
            if (amount && amount > 0) {
                this.logger.debug(`💰 [getApprovalRouting] Amount-based routing for: ${amount}`);
                const financialApprovers = await this.getFinancialApprovers(amount, requester);
                financialApprovers.forEach((approver, index) => {
                    approvers.push({
                        approver: approver.user,
                        priority: approver.priority,
                        reason: approver.reason,
                    });
                });
            }

            // Hierarchical routing based on organizational structure
            const hierarchicalApprovers = await this.getHierarchicalApprovers(requester);
            hierarchicalApprovers.forEach((approver) => {
                // Avoid duplicates
                if (!approvers.find(a => a.approver.uid === approver.approver.uid)) {
                    approvers.push(approver);
                }
            });

            // Sort by priority and remove duplicates
            const uniqueApprovers = approvers
                .filter((approver, index, self) => 
                    index === self.findIndex(a => a.approver.uid === approver.approver.uid)
                )
                .sort((a, b) => a.priority - b.priority);

            this.logger.log(`✅ [getApprovalRouting] Found ${uniqueApprovers.length} potential approvers for ${approvalType}`);
            return uniqueApprovers;
        } catch (error) {
            this.logger.error(`❌ [getApprovalRouting] Error determining approval routing:`, error.message);
            return [];
        }
    }

    /**
     * 👥 Get HR users for HR-related approvals
     * @param organisationRef - Organization reference
     * @returns Array of HR users
     */
    private async getHRUsers(organisationRef: string): Promise<User[]> {
        try {
            this.logger.debug(`👥 [getHRUsers] Finding HR users for organization: ${organisationRef}`);
            
            const hrUsers = await this.userRepository.find({
                where: {
                    organisationRef,
                    accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER]),
                    isDeleted: false,
                    status: 'active',
                },
                order: {
                    accessLevel: 'DESC', // Prioritize by access level
                },
            });

            this.logger.debug(`✅ [getHRUsers] Found ${hrUsers.length} HR users`);
            return hrUsers;
        } catch (error) {
            this.logger.error(`❌ [getHRUsers] Error finding HR users:`, error.message);
            return [];
        }
    }

    /**
     * 💰 Get financial approvers based on amount thresholds
     * @param amount - Approval amount
     * @param requester - User requesting approval
     * @returns Array of financial approvers with priority
     */
    private async getFinancialApprovers(
        amount: number,
        requester: User,
    ): Promise<{ user: User; priority: number; reason: string }[]> {
        try {
            this.logger.debug(`💰 [getFinancialApprovers] Finding approvers for amount: ${amount}`);
            
            const approvers: { user: User; priority: number; reason: string }[] = [];

            // Define amount thresholds and required approval levels
            const thresholds = [
                { max: 1000, level: AccessLevel.MANAGER, reason: 'Manager approval for amounts up to R1,000' },
                { max: 10000, level: AccessLevel.ADMIN, reason: 'Admin approval for amounts up to R10,000' },
                { max: Infinity, level: AccessLevel.OWNER, reason: 'Owner approval for amounts over R10,000' },
            ];

            // Find appropriate threshold
            const threshold = thresholds.find(t => amount <= t.max);
            if (!threshold) return approvers;

            // Get users with required access level or higher
            const requiredLevels = [threshold.level];
            if (threshold.level === AccessLevel.MANAGER) {
                requiredLevels.push(AccessLevel.ADMIN, AccessLevel.OWNER);
            } else if (threshold.level === AccessLevel.ADMIN) {
                requiredLevels.push(AccessLevel.OWNER);
            }

            const financialApprovers = await this.userRepository.find({
                where: {
                    organisationRef: requester.organisationRef,
                    accessLevel: In(requiredLevels),
                    isDeleted: false,
                    status: 'active',
                },
                order: {
                    accessLevel: 'DESC',
                },
            });

            financialApprovers.forEach((user, index) => {
                approvers.push({
                    user,
                    priority: index + 1,
                    reason: threshold.reason,
                });
            });

            this.logger.debug(`✅ [getFinancialApprovers] Found ${approvers.length} financial approvers`);
            return approvers;
        } catch (error) {
            this.logger.error(`❌ [getFinancialApprovers] Error finding financial approvers:`, error.message);
            return [];
        }
    }

    /**
     * 🏢 Get hierarchical approvers based on organizational structure
     * @param requester - User requesting approval
     * @returns Array of hierarchical approvers
     */
    private async getHierarchicalApprovers(
        requester: User,
    ): Promise<{ approver: User; priority: number; reason: string }[]> {
        try {
            this.logger.debug(`🏢 [getHierarchicalApprovers] Finding hierarchical approvers for user: ${requester.uid}`);
            
            const approvers: { approver: User; priority: number; reason: string }[] = [];

            // Get branch managers first
            if (requester.branch?.uid) {
                const branchManagers = await this.userRepository.find({
                    where: {
                        branch: { uid: requester.branch.uid },
                        accessLevel: In([AccessLevel.MANAGER, AccessLevel.ADMIN, AccessLevel.OWNER]),
                        isDeleted: false,
                        status: 'active',
                    },
                    order: {
                        accessLevel: 'DESC',
                    },
                });

                branchManagers.forEach((manager, index) => {
                    if (manager.uid !== requester.uid) { // Don't include self
                        approvers.push({
                            approver: manager,
                            priority: index + 10, // Lower priority than specific routing
                            reason: 'Branch hierarchy approval',
                        });
                    }
                });
            }

            // Get organization admins and owners
            const orgAdmins = await this.userRepository.find({
                where: {
                    organisationRef: requester.organisationRef,
                    accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER]),
                    isDeleted: false,
                    status: 'active',
                },
                order: {
                    accessLevel: 'DESC',
                },
            });

            orgAdmins.forEach((admin, index) => {
                if (admin.uid !== requester.uid) { // Don't include self
                    approvers.push({
                        approver: admin,
                        priority: index + 20, // Even lower priority
                        reason: 'Organization hierarchy approval',
                    });
                }
            });

            this.logger.debug(`✅ [getHierarchicalApprovers] Found ${approvers.length} hierarchical approvers`);
            return approvers;
        } catch (error) {
            this.logger.error(`❌ [getHierarchicalApprovers] Error finding hierarchical approvers:`, error.message);
            return [];
        }
    }

    /**
     * 🔍 Compare two approval objects and return changes
     * @param original - Original approval data
     * @param updated - Updated approval data
     * @returns Object containing the changes
     */
    private getChanges(original: any, updated: any): Record<string, { from: any; to: any }> {
        const changes: Record<string, { from: any; to: any }> = {};
        
        // Fields to track for changes
        const trackableFields = [
            'title', 'description', 'type', 'priority', 'amount', 'currency',
            'deadline', 'approverUid', 'status', 'isUrgent', 'entityType', 'entityId'
        ];

        trackableFields.forEach(field => {
            if (original[field] !== updated[field]) {
                changes[field] = {
                    from: original[field],
                    to: updated[field]
                };
            }
        });

        return changes;
    }

    // Create new approval request
    async create(createApprovalDto: CreateApprovalDto, user: RequestUser) {
        const startTime = Date.now();
        this.logger.log(`🚀 [create] Creating new approval request by user ${user.uid}`);
        
        try {
            this.logger.debug(`📋 [create] Approval data: ${JSON.stringify({ ...createApprovalDto, supportingDocuments: createApprovalDto.supportingDocuments?.length || 0 })}`);

            // Validate requester has permission to create this type of approval
            await this.validateCreatePermissions(createApprovalDto, user);

            // Get full user data for approval routing
            const fullUser = await this.userRepository.findOne({
                where: { uid: user.uid },
                relations: ['organisation', 'branch'],
            });

            if (!fullUser) {
                throw new NotFoundException('User not found');
            }

            this.logger.log(`📋 [create] Creating approval for user: ${fullUser.email}`);
        

            // Create approval entity
            const { supportingDocuments, autoSubmit, ...approvalData } = createApprovalDto;
            const approval = this.approvalRepository.create({
                ...approvalData,
                requesterUid: user.uid,
                organisationRef: user.organisationRef?.toString() || '',
                branchUid: user.branch?.uid,
                requestSource: 'web',
                // If autoSubmit is true, create as PENDING; otherwise create as DRAFT
                status: autoSubmit ? ApprovalStatus.PENDING : ApprovalStatus.DRAFT,
                submittedAt: autoSubmit ? new Date() : undefined,
                supportingDocuments: supportingDocuments?.map(doc => doc.url) || []
            });

            // Smart approval routing - determine best approver if not specified
            if (!approval.approverUid) {
                this.logger.debug(`🎯 [create] No approver specified, using smart routing for type: ${approval.type}`);
                const approvalRouting = await this.getApprovalRouting(
                    approval.type, 
                    approval.amount, 
                    fullUser
                );

                if (approvalRouting.length > 0) {
                    const primaryApprover = approvalRouting[0];
                    approval.approverUid = primaryApprover.approver.uid;
                    this.logger.log(`✅ [create] Auto-assigned approver: ${primaryApprover.approver.email} (reason: ${primaryApprover.reason})`);
                } else {
                    // Fallback to default approver
                    const fallbackApprover = await this.getDefaultApprover(approval.type, user);
                    if (fallbackApprover) {
                        approval.approverUid = fallbackApprover.uid;
                        this.logger.log(`🔄 [create] Using fallback approver: ${fallbackApprover.email}`);
                    }
                }
            }

            this.logger.debug(`💾 [create] Saving approval to database`);
            const savedApproval = await this.approvalRepository.save(approval);

            // Create initial history entry
            const initialStatus = autoSubmit ? ApprovalStatus.PENDING : ApprovalStatus.DRAFT;
            await this.createHistoryEntry(
                savedApproval.uid,
                autoSubmit ? ApprovalAction.SUBMIT : ApprovalAction.SUBMIT,
                null,
                initialStatus,
                user.uid,
                autoSubmit ? 'Approval request created and auto-submitted' : 'Approval request created'
            );

            // Clear relevant caches
            await this.invalidateApprovalCache(savedApproval);

            // Send notification email (use 'submitted' if auto-submitted, otherwise 'created')
            const notificationType = autoSubmit ? 'submitted' : 'created';
            this.logger.debug(`📧 [create] Sending ${notificationType} notification emails`);
            await this.sendApprovalNotification(savedApproval, notificationType);

            // Send push notifications
            this.logger.debug(`📱 [create] Sending ${notificationType} push notifications`);
            try {
                const recipients = [];
                if (savedApproval.approverUid) {
                    recipients.push(savedApproval.approverUid);
                }
                
                if (recipients.length > 0) {
                    const pushEvent = autoSubmit ? 'APPROVAL_SUBMITTED' : 'APPROVAL_CREATED';
                    await this.sendApprovalPushNotification(
                        savedApproval,
                        pushEvent,
                        recipients,
                        {
                            action: autoSubmit ? 'submitted' : 'created',
                            requesterName: fullUser.name,
                            message: autoSubmit 
                                ? `Approval request submitted for your review: ${savedApproval.title}`
                                : `New approval request from ${fullUser.name}: ${savedApproval.title}`,
                        }
                    );
                }
            } catch (pushError) {
                this.logger.warn(`⚠️ [create] Failed to send push notifications: ${pushError.message}`);
            }

            // Emit WebSocket event for real-time updates
            this.eventEmitter.emit('approval.created', {
                approvalId: savedApproval.uid,
                approvalReference: savedApproval.approvalReference,
                type: savedApproval.type,
                status: savedApproval.status,
                priority: savedApproval.priority,
                requesterUid: savedApproval.requesterUid,
                approverUid: savedApproval.approverUid,
                title: savedApproval.title,
                amount: savedApproval.amount,
                currency: savedApproval.currency,
                organisationRef: savedApproval.organisationRef,
                branchUid: savedApproval.branchUid,
                timestamp: new Date(),
            });

            // Emit real-time notification to mobile/POS/ERP systems
            this.eventEmitter.emit('websocket.broadcast', {
                event: 'approval_created',
                data: {
                    approvalId: savedApproval.uid,
                    approvalReference: savedApproval.approvalReference,
                    type: savedApproval.type,
                    priority: savedApproval.priority,
                    requester: {
                        uid: fullUser.uid,
                        name: fullUser.name,
                        email: fullUser.email,
                    },
                    approver: approval.approverUid ? {
                        uid: approval.approverUid,
                    } : null,
                    title: savedApproval.title,
                    amount: savedApproval.amount,
                    currency: savedApproval.currency,
                },
                targetRoles: ['admin', 'manager', 'approver'],
                organisationRef: savedApproval.organisationRef,
                branchUid: savedApproval.branchUid,
            });

            const executionTime = Date.now() - startTime;
            this.logger.log(`🎉 [create] Approval request created successfully: ${savedApproval.approvalReference} in ${executionTime}ms`);

            return {
                uid: savedApproval.uid,
                title: savedApproval.title,
                type: savedApproval.type,
                status: savedApproval.status,
                approvalReference: savedApproval.approvalReference,
                approverUid: savedApproval.approverUid,
                amount: savedApproval.amount,
                currency: savedApproval.currency,
                message: 'Approval request created successfully'
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`❌ [create] Failed to create approval request after ${executionTime}ms: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get all approvals with filtering and pagination
    async findAll(query: ApprovalQueryDto, user: RequestUser) {
        const startTime = Date.now();
        this.logger.log(`📋 [findAll] ============ APPROVALS FINDALL START ============`);
        this.logger.log(`📋 [findAll] 🎯 Target: Fetching approvals for user ${user.uid}`);
        this.logger.log(`📋 [findAll] 👤 User Details: uid=${user.uid}, role=${user.accessLevel}, org=${user.organisationRef}, branch=${user.branch?.uid || 'N/A'}`);
        this.logger.log(`📋 [findAll] 🔍 Query filters: ${JSON.stringify(query, null, 2)}`);
        
        try {

            // Generate cache key based on query parameters and user
            const cacheKey = this.getCacheKey(`findAll_${user.organisationRef}_${user.uid}_${JSON.stringify(query)}`);
            
            // Check cache first (only for non-real-time queries)
            if (!query.includeHistory && !query.includeSignatures) {
                this.logger.log(`🗄️ [findAll] Checking cache with key: ${cacheKey}`);
                const cachedResults = await this.cacheManager.get(cacheKey);
                if (cachedResults) {
                    this.logger.log(`✅ [findAll] 📊 CACHE HIT! Returning cached results for user ${user.uid}`);
                    this.logger.log(`✅ [findAll] 📊 Cached data contains ${cachedResults.data?.length || 0} approvals`);
                    return cachedResults;
                }
                this.logger.log(`❌ [findAll] 📊 CACHE MISS - fetching from database`);
            }

            this.logger.log(`🏗️ [findAll] Building database query...`);
            const queryBuilder = this.approvalRepository
                .createQueryBuilder('approval')
                .leftJoinAndSelect('approval.requester', 'requester')
                .leftJoinAndSelect('approval.approver', 'approver')
                .leftJoinAndSelect('approval.delegatedTo', 'delegatedTo')
                .leftJoinAndSelect('approval.organisation', 'organisation')
                .leftJoinAndSelect('approval.branch', 'branch');

            // Apply comprehensive scoping (org, branch, user access)
            this.logger.log(`🔒 [findAll] Applying security scoping filters for user ${user.uid}`);
            this.applyScopingFilters(queryBuilder, user);

            // Apply search filters
            this.logger.log(`🔍 [findAll] Applying search and filter constraints`);
            this.applySearchFilters(queryBuilder, query);

            // Apply sorting
            const sortBy = query.sortBy || 'createdAt';
            const sortOrder = query.sortOrder || 'DESC';
            this.logger.log(`📊 [findAll] Sorting by: ${sortBy} ${sortOrder}`);
            queryBuilder.orderBy(`approval.${sortBy}`, sortOrder);

            // Apply pagination
            const page = query.page || 1;
            const limit = Math.min(query.limit || 20, 100);
            const skip = (page - 1) * limit;
            this.logger.log(`📖 [findAll] Pagination: page=${page}, limit=${limit}, skip=${skip}`);

            queryBuilder.skip(skip).take(limit);

            // Include additional relations if requested
            if (query.includeHistory) {
                this.logger.log(`📜 [findAll] Including approval history in query`);
                queryBuilder.leftJoinAndSelect('approval.history', 'history');
            }
            if (query.includeSignatures) {
                this.logger.log(`✍️ [findAll] Including approval signatures in query`);
                queryBuilder.leftJoinAndSelect('approval.signatures', 'signatures');
            }

            this.logger.log(`🚀 [findAll] Executing database query...`);
            const [approvals, total] = await queryBuilder.getManyAndCount();
            this.logger.log(`📊 [findAll] Database query completed: found ${approvals.length} approvals out of ${total} total`);
            
            // Log detailed results for debugging
            approvals.forEach((approval, index) => {
                this.logger.debug(`📋 [findAll] Approval ${index + 1}: ${approval.approvalReference} - ${approval.title} (${approval.status}) by ${approval.requester?.email || 'unknown'}`);
            });

            const totalPages = Math.ceil(total / limit);

            // Calculate some basic metrics
            const pendingCount = approvals.filter(a => a.status === ApprovalStatus.PENDING).length;
            const overdueCount = approvals.filter(a => a.isOverdue).length;
            const urgentCount = approvals.filter(a => a.isUrgent || a.priority === ApprovalPriority.URGENT).length;

            const result = {
                data: approvals,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                },
                metrics: {
                    pendingCount,
                    overdueCount,
                    urgentCount,
                    totalValue: approvals.reduce((sum, approval) => sum + (approval.amount || 0), 0)
                },
                filters: query,
                message: 'Approvals retrieved successfully'
            };

            // Cache results for 2 minutes (but only if not including dynamic data)
            if (!query.includeHistory && !query.includeSignatures) {
                await this.cacheManager.set(cacheKey, result, 120000);
            }

            const executionTime = Date.now() - startTime;
            this.logger.log(`🎉 [findAll] ============ APPROVALS FINDALL SUCCESS ============`);
            this.logger.log(`✅ [findAll] 📊 Results: ${approvals.length} approvals retrieved out of ${total} total`);
            this.logger.log(`✅ [findAll] 📈 Metrics: ${pendingCount} pending, ${overdueCount} overdue, ${urgentCount} urgent`);
            this.logger.log(`✅ [findAll] 💰 Total value: ${result.metrics.totalValue} (currency varies)`);
            this.logger.log(`✅ [findAll] 📖 Pagination: page ${page}/${totalPages} (${result.pagination.hasNext ? 'has next' : 'last page'})`);
            this.logger.log(`✅ [findAll] ⏱️ Execution time: ${executionTime}ms`);
            this.logger.log(`🎉 [findAll] ============ APPROVALS FINDALL END ============`);

            return result;

        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`❌ [findAll] Failed to fetch approvals after ${executionTime}ms: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get pending approvals for current user
    async getPendingApprovals(user: RequestUser) {
        const startTime = Date.now();
        try {
            this.logger.log(`⏳ [getPendingApprovals] ============ PENDING APPROVALS START ============`);
            this.logger.log(`⏳ [getPendingApprovals] 🎯 Target: Fetching pending approvals for user ${user.uid}`);
            this.logger.log(`⏳ [getPendingApprovals] 👤 User Details: uid=${user.uid}, role=${user.accessLevel}, org=${user.organisationRef}, branch=${user.branch?.uid || 'N/A'}`);
            this.logger.log(`⏳ [getPendingApprovals] 🔍 Looking for statuses: [PENDING, ADDITIONAL_INFO_REQUIRED, ESCALATED]`);

            this.logger.log(`🏗️ [getPendingApprovals] Building pending approvals query...`);
            const queryBuilder = this.approvalRepository
                .createQueryBuilder('approval')
                .leftJoinAndSelect('approval.requester', 'requester')
                .leftJoinAndSelect('approval.approver', 'approver')
                .leftJoinAndSelect('approval.delegatedTo', 'delegatedTo')
                .leftJoinAndSelect('approval.organisation', 'organisation')
                .leftJoinAndSelect('approval.branch', 'branch')
                .where('approval.status IN (:...statuses)', { 
                    statuses: [ApprovalStatus.PENDING, ApprovalStatus.ADDITIONAL_INFO_REQUIRED, ApprovalStatus.ESCALATED] 
                })
                .andWhere('(approval.approverUid = :uid OR approval.delegatedToUid = :uid)', { uid: user.uid });

            // Apply comprehensive scoping (org, branch, user access)
            this.logger.log(`🔒 [getPendingApprovals] Applying security scoping filters`);
            this.applyScopingFilters(queryBuilder, user);

            this.logger.log(`📊 [getPendingApprovals] Setting sort order: priority DESC, submittedAt ASC`);
            this.logger.log(`🚀 [getPendingApprovals] Executing database query...`);
            const approvals = await queryBuilder
                .orderBy('approval.priority', 'DESC')
                .addOrderBy('approval.submittedAt', 'ASC')
                .getMany();

            const executionTime = Date.now() - startTime;
            this.logger.log(`📊 [getPendingApprovals] Database query completed: found ${approvals.length} pending approvals`);
            
            // Log detailed results for debugging
            approvals.forEach((approval, index) => {
                this.logger.debug(`⏳ [getPendingApprovals] Pending ${index + 1}: ${approval.approvalReference} - ${approval.title} (${approval.status}) - Priority: ${approval.priority} by ${approval.requester?.email || 'unknown'}`);
            });

            this.logger.log(`🎉 [getPendingApprovals] ============ PENDING APPROVALS SUCCESS ============`);
            this.logger.log(`✅ [getPendingApprovals] 📊 Found ${approvals.length} pending approvals for user ${user.uid}`);
            this.logger.log(`✅ [getPendingApprovals] ⏱️ Execution time: ${executionTime}ms`);
            this.logger.log(`🎉 [getPendingApprovals] ============ PENDING APPROVALS END ============`);

            return {
                data: approvals,
                count: approvals.length,
                message: 'Pending approvals retrieved successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to fetch pending approvals: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get approval requests submitted by current user
    async getMyRequests(query: ApprovalQueryDto, user: RequestUser) {
        const startTime = Date.now();
        try {
            this.logger.log(`📝 [getMyRequests] ============ MY REQUESTS START ============`);
            this.logger.log(`📝 [getMyRequests] 🎯 Target: Fetching approval requests submitted by user ${user.uid}`);
            this.logger.log(`📝 [getMyRequests] 👤 User Details: uid=${user.uid}, role=${user.accessLevel}, org=${user.organisationRef}, branch=${user.branch?.uid || 'N/A'}`);
            this.logger.log(`📝 [getMyRequests] 🔍 Query filters: ${JSON.stringify(query, null, 2)}`);

            this.logger.log(`🏗️ [getMyRequests] Building my requests query...`);
            const queryBuilder = this.approvalRepository
                .createQueryBuilder('approval')
                .leftJoinAndSelect('approval.requester', 'requester')
                .leftJoinAndSelect('approval.approver', 'approver')
                .leftJoinAndSelect('approval.delegatedTo', 'delegatedTo')
                .leftJoinAndSelect('approval.organisation', 'organisation')
                .leftJoinAndSelect('approval.branch', 'branch')
                .where('approval.requesterUid = :uid', { uid: user.uid });

            // Apply comprehensive scoping (org, branch, user access)  
            this.logger.log(`🔒 [getMyRequests] Applying security scoping filters`);
            this.applyScopingFilters(queryBuilder, user);

            // Apply search filters if provided
            if (query.search) {
                this.logger.log(`🔍 [getMyRequests] Applying search filter: "${query.search}"`);
                queryBuilder.andWhere(
                    '(approval.title LIKE :search OR approval.description LIKE :search OR approval.type LIKE :search)',
                    { search: `%${query.search}%` }
                );
            }

            if (query.status) {
                this.logger.log(`🔍 [getMyRequests] Filtering by status: ${query.status}`);
                queryBuilder.andWhere('approval.status = :status', { status: query.status });
            }

            if (query.type) {
                this.logger.log(`🔍 [getMyRequests] Filtering by type: ${query.type}`);
                queryBuilder.andWhere('approval.type = :type', { type: query.type });
            }

            // Apply sorting
            const sortBy = query.sortBy || 'createdAt';
            const sortOrder = query.sortOrder || 'DESC';
            this.logger.log(`📊 [getMyRequests] Sorting by: ${sortBy} ${sortOrder}`);
            queryBuilder.orderBy(`approval.${sortBy}`, sortOrder);

            // Apply pagination
            const page = query.page || 1;
            const limit = Math.min(query.limit || 20, 100);
            const skip = (page - 1) * limit;
            this.logger.log(`📖 [getMyRequests] Pagination: page=${page}, limit=${limit}, skip=${skip}`);

            this.logger.log(`🚀 [getMyRequests] Executing database query...`);
            const [approvals, total] = await queryBuilder
                .skip(skip)
                .take(limit)
                .getManyAndCount();
            const totalPages = Math.ceil(total / limit);

            const executionTime = Date.now() - startTime;
            this.logger.log(`📊 [getMyRequests] Database query completed: found ${approvals.length} requests out of ${total} total`);
            
            // Log detailed results for debugging
            approvals.forEach((approval, index) => {
                this.logger.debug(`📝 [getMyRequests] Request ${index + 1}: ${approval.approvalReference} - ${approval.title} (${approval.status}) - Type: ${approval.type}`);
            });

            this.logger.log(`🎉 [getMyRequests] ============ MY REQUESTS SUCCESS ============`);
            this.logger.log(`✅ [getMyRequests] 📊 Results: ${approvals.length} requests retrieved out of ${total} total`);
            this.logger.log(`✅ [getMyRequests] 📖 Pagination: page ${page}/${totalPages}`);
            this.logger.log(`✅ [getMyRequests] ⏱️ Execution time: ${executionTime}ms`);
            this.logger.log(`🎉 [getMyRequests] ============ MY REQUESTS END ============`);

            return {
                data: approvals,
                pagination: { page, limit, total, totalPages },
                message: 'Your approval requests retrieved successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to fetch user's approval requests: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get comprehensive approval history for a specific user (matching warnings pattern)
    async getUserApprovals(userId: number): Promise<{ 
        success: boolean; 
        data: { 
            employee: any; 
            approvals: Approval[]; 
            analytics: any 
        }; 
        message: string 
    }> {
        try {
            const cacheKey = this.getCacheKey(`user_${userId}`);
            const cachedResult = await this.cacheManager.get<{ success: boolean; data: any; message: string }>(cacheKey);

            if (cachedResult) {
                return cachedResult;
            }

            // Get user details
            const user = await this.userRepository.findOne({
                where: { uid: userId },
                relations: ['organisation', 'branch'],
            });

            if (!user) {
                return {
                    success: false,
                    data: {
                        employee: { uid: userId },
                        approvals: [],
                        analytics: {
                            summary: {
                                totalApprovals: 0,
                                pendingApprovals: 0,
                                approvedApprovals: 0,
                                rejectedApprovals: 0,
                            },
                        },
                    },
                    message: 'User not found',
                };
            }

            // Get all approvals for this user
            const approvals = await this.approvalRepository.find({
                where: {
                    requesterUid: userId,
                },
                relations: ['requester', 'approver', 'delegatedTo', 'organisation', 'branch'],
                order: {
                    createdAt: 'DESC',
                },
            });

            // Calculate analytics
            const analytics = {
                summary: {
                    totalApprovals: approvals.length,
                    pendingApprovals: approvals.filter(a => a.status === ApprovalStatus.PENDING).length,
                    approvedApprovals: approvals.filter(a => a.status === ApprovalStatus.APPROVED).length,
                    rejectedApprovals: approvals.filter(a => a.status === ApprovalStatus.REJECTED).length,
                    draftApprovals: approvals.filter(a => a.status === ApprovalStatus.DRAFT).length,
                    withdrawnApprovals: approvals.filter(a => a.status === ApprovalStatus.WITHDRAWN).length,
                },
                byType: approvals.reduce((acc, approval) => {
                    acc[approval.type] = (acc[approval.type] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>),
                byStatus: approvals.reduce((acc, approval) => {
                    acc[approval.status] = (acc[approval.status] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>),
            };

            const result = {
                success: true,
                data: {
                    employee: {
                        uid: user.uid,
                        name: user.name,
                        surname: user.surname,
                        email: user.email,
                        departmentId: user.departmentId,
                    },
                    approvals,
                    analytics,
                },
                message: approvals.length > 0 ? 'Approvals found' : 'No approvals found',
            };

            await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
            return result;
        } catch (error) {
            this.logger.error(`Error retrieving user approvals: ${error.message}`, error.stack);
            return {
                success: false,
                data: {
                    employee: { uid: userId },
                    approvals: [],
                    analytics: {
                        summary: {
                            totalApprovals: 0,
                            pendingApprovals: 0,
                            approvedApprovals: 0,
                            rejectedApprovals: 0,
                        },
                    },
                },
                message: error?.message || 'Error retrieving user approvals',
            };
        }
    }

    // Get approval statistics
    async getStats(user: RequestUser) {
        const startTime = Date.now();
        try {
            this.logger.log(`📊 [getStats] ============ APPROVAL STATS START ============`);
            this.logger.log(`📊 [getStats] 🎯 Target: Generating approval statistics for user ${user.uid}`);
            this.logger.log(`📊 [getStats] 👤 User Details: uid=${user.uid}, role=${user.accessLevel}, org=${user.organisationRef}, branch=${user.branch?.uid || 'N/A'}`);

            // Check cache first
            const cacheKey = this.getCacheKey(`stats_${user.organisationRef}_${user.uid}`);
            this.logger.log(`🗄️ [getStats] Checking cache with key: ${cacheKey}`);
            const cachedStats = await this.cacheManager.get(cacheKey);
            if (cachedStats) {
                this.logger.log(`✅ [getStats] 📊 CACHE HIT! Returning cached statistics for user ${user.uid}`);
                this.logger.log(`✅ [getStats] 📊 Cached stats: ${JSON.stringify(cachedStats.summary)}`);
                return cachedStats;
            }
            this.logger.log(`❌ [getStats] 📊 CACHE MISS - generating fresh statistics`);
        

            this.logger.log(`🏗️ [getStats] Building statistics queries...`);
            const baseQuery = this.approvalRepository
                .createQueryBuilder('approval');

            // Apply comprehensive scoping for base statistics
            this.logger.log(`🔒 [getStats] Applying security scoping filters for statistics`);
            this.applyScopingFilters(baseQuery, user);

            // Get total counts by status
            this.logger.log(`📊 [getStats] Fetching status counts...`);
            const statusCounts = await baseQuery
                .select('approval.status', 'status')
                .addSelect('COUNT(*)', 'count')
                .groupBy('approval.status')
                .getRawMany();

            this.logger.log(`📊 [getStats] Raw status counts: ${JSON.stringify(statusCounts)}`);

            // Process status counts
            const statusMap = statusCounts.reduce((acc, item) => {
                acc[item.status] = parseInt(item.count);
                return acc;
            }, {} as Record<string, number>);

            const total = statusCounts.reduce((sum, item) => sum + parseInt(item.count), 0);
            const pending = statusMap[ApprovalStatus.PENDING] || 0;
            const approved = statusMap[ApprovalStatus.APPROVED] || 0;
            const rejected = statusMap[ApprovalStatus.REJECTED] || 0;

            this.logger.log(`📊 [getStats] Processed counts: total=${total}, pending=${pending}, approved=${approved}, rejected=${rejected}`);

            // Get overdue count separately
            this.logger.log(`⏰ [getStats] Fetching overdue count...`);
            const overdueQuery = this.approvalRepository.createQueryBuilder('approval');
            this.applyScopingFilters(overdueQuery, user);
            const overdue = await overdueQuery
                .andWhere('approval.isOverdue = :overdue', { overdue: true })
                .getCount();

            this.logger.log(`⏰ [getStats] Overdue count: ${overdue}`);

            // Get statistics by type
            this.logger.log(`📋 [getStats] Fetching type breakdown...`);
            const typeQuery = this.approvalRepository.createQueryBuilder('approval');
            this.applyScopingFilters(typeQuery, user);
            const typeStats = await typeQuery
                .select('approval.type', 'type')
                .addSelect('COUNT(*)', 'count')
                .groupBy('approval.type')
                .getRawMany();

            this.logger.log(`📋 [getStats] Type breakdown: ${JSON.stringify(typeStats)}`);

            // Get recent activity (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            this.logger.log(`📅 [getStats] Fetching recent activity since: ${thirtyDaysAgo.toISOString()}`);
            
            const recentQuery = this.approvalRepository.createQueryBuilder('approval');
            this.applyScopingFilters(recentQuery, user);
            const recentActivity = await recentQuery
                .where('approval.createdAt >= :date', { date: thirtyDaysAgo })
                .getCount();

            this.logger.log(`📅 [getStats] Recent activity count: ${recentActivity}`);

            const stats = {
                summary: {
                    total,
                    pending,
                    approved,
                    rejected,
                    overdue
                },
                byType: typeStats.reduce((acc, item) => {
                    acc[item.type] = parseInt(item.count);
                    return acc;
                }, {} as Record<string, number>),
                byStatus: statusMap,
                recentActivity: recentActivity,
                userInfo: {
                    uid: user.uid,
                    accessLevel: user.accessLevel,
                    canApprove: [AccessLevel.MANAGER, AccessLevel.ADMIN, AccessLevel.OWNER].includes(user.accessLevel)
                }
            };

            // Cache the results for 2 minutes
            this.logger.log(`🗄️ [getStats] Caching statistics for 2 minutes`);
            await this.cacheManager.set(cacheKey, stats, 120000);

            const executionTime = Date.now() - startTime;
            this.logger.log(`🎉 [getStats] ============ APPROVAL STATS SUCCESS ============`);
            this.logger.log(`✅ [getStats] 📊 Generated statistics for user ${user.uid}: ${total} total approvals`);
            this.logger.log(`✅ [getStats] 📈 Summary: ${pending} pending, ${approved} approved, ${rejected} rejected, ${overdue} overdue`);
            this.logger.log(`✅ [getStats] 🔍 User can approve: ${stats.userInfo.canApprove}`);
            this.logger.log(`✅ [getStats] 📅 Recent activity (30 days): ${recentActivity} approvals`);
            this.logger.log(`✅ [getStats] ⏱️ Execution time: ${executionTime}ms`);
            this.logger.log(`🎉 [getStats] ============ APPROVAL STATS END ============`);
            
            return stats;

        } catch (error) {
            this.logger.error(`Failed to generate statistics for user ${user.uid}: ${error.message}`, error.stack);
            throw new BadRequestException('Failed to generate approval statistics');
        }
    }

    // Get specific approval by ID
    async findOne(id: number, user: RequestUser) {
        const startTime = Date.now();
        this.logger.log(`🔍 [findOne] Fetching approval ${id} for user ${user.uid}`);
        
        try {
            // Check cache first
            const cacheKey = this.getCacheKey(`findOne_${id}_${user.uid}`);
            const cachedApproval = await this.cacheManager.get(cacheKey);
            
            if (cachedApproval) {
                this.logger.debug(`📊 [findOne] Returning cached approval ${id} for user ${user.uid}`);
                
                // Still need to validate access for cached results
                await this.validateApprovalAccess(cachedApproval, user);
                return cachedApproval;
            }

            this.logger.debug(`🔍 [findOne] Cache miss, querying database for approval ${id}`);

            const queryBuilder = this.approvalRepository
                .createQueryBuilder('approval')
                .leftJoinAndSelect('approval.requester', 'requester')
                .leftJoinAndSelect('approval.approver', 'approver')
                .leftJoinAndSelect('approval.delegatedTo', 'delegatedTo')
                .leftJoinAndSelect('approval.delegatedFrom', 'delegatedFrom')
                .leftJoinAndSelect('approval.organisation', 'organisation')
                .leftJoinAndSelect('approval.branch', 'branch')
                .leftJoinAndSelect('approval.history', 'history')
                .leftJoinAndSelect('history.actionByUser', 'historyUser')
                .leftJoinAndSelect('approval.signatures', 'signatures')
                .where('approval.uid = :id', { id });

            // Apply comprehensive scoping
            this.applyScopingFilters(queryBuilder, user);

            const approval = await queryBuilder.getOne();

            if (!approval) {
                this.logger.warn(`⚠️ [findOne] Approval ${id} not found or access denied for user ${user.uid}`);
                throw new NotFoundException(`Approval with ID ${id} not found or access denied`);
            }

            // Additional access validation
            await this.validateApprovalAccess(approval, user);

            // Cache the result for 5 minutes
            await this.cacheManager.set(cacheKey, approval, 300000);

            const executionTime = Date.now() - startTime;
            this.logger.log(`✅ [findOne] Successfully fetched approval ${id} for user ${user.uid} in ${executionTime}ms`);
            
            return approval;

        } catch (error) {
            const executionTime = Date.now() - startTime;
            
            if (error instanceof NotFoundException || error instanceof ForbiddenException) {
                this.logger.warn(`⚠️ [findOne] Access denied to approval ${id} for user ${user.uid} after ${executionTime}ms: ${error.message}`);
                throw error;
            }
            
            this.logger.error(`❌ [findOne] Failed to fetch approval ${id} for user ${user.uid} after ${executionTime}ms: ${error.message}`, error.stack);
            throw new BadRequestException('Failed to fetch approval');
        }
    }

    // Update approval (draft only)
    async update(id: number, updateApprovalDto: UpdateApprovalDto, user: RequestUser) {
        const startTime = Date.now();
        this.logger.log(`🔄 [update] Updating approval ${id} by user ${user.uid}`);
        
        try {
            this.logger.debug(`📋 [update] Update data: ${JSON.stringify(updateApprovalDto)}`);

            const approval = await this.findOne(id, user);

            // Only allow updates to draft approvals by the requester
            if (approval.status !== ApprovalStatus.DRAFT) {
                this.logger.warn(`⚠️ [update] Cannot modify approval ${id} in status: ${approval.status}`);
                throw new BadRequestException('Cannot modify approval in current status');
            }

            if (approval.requesterUid !== user.uid) {
                this.logger.warn(`⚠️ [update] User ${user.uid} not authorized to modify approval ${id} (requester: ${approval.requesterUid})`);
                throw new ForbiddenException('Only the requester can modify this approval');
            }

            // Store original data for comparison
            const originalData = { ...approval };

            // Update approval
            Object.assign(approval, updateApprovalDto);
            approval.version += 1;

            this.logger.debug(`💾 [update] Saving updated approval to database`);
            const updatedApproval = await this.approvalRepository.save(approval);

            // Create history entry
            await this.createHistoryEntry(
                approval.uid,
                ApprovalAction.SUBMIT,
                ApprovalStatus.DRAFT,
                ApprovalStatus.DRAFT,
                user.uid,
                'Approval request updated'
            );

            // Clear relevant caches
            await this.invalidateApprovalCache(updatedApproval);

            // Send update notification email
            this.logger.debug(`📧 [update] Sending update notification emails`);
            await this.sendApprovalNotification(updatedApproval, 'updated');

            // Send push notification for update
            try {
                const recipients = [];
                if (updatedApproval.approverUid && updatedApproval.approverUid !== user.uid) {
                    recipients.push(updatedApproval.approverUid);
                }

                if (recipients.length > 0) {
                    const requester = await this.userRepository.findOne({
                        where: { uid: user.uid },
                        select: ['name', 'surname']
                    });
                    const requesterName = requester ? `${requester.name} ${requester.surname}`.trim() : 'Team Member';

                    await this.sendApprovalPushNotification(
                        updatedApproval,
                        'APPROVAL_UPDATED',
                        recipients,
                        {
                            action: 'updated',
                            updatedBy: requesterName,
                            message: `Approval request "${updatedApproval.title}" has been updated`,
                            version: updatedApproval.version,
                        }
                    );
                }
            } catch (pushError) {
                this.logger.warn(`⚠️ [update] Failed to send push notifications: ${pushError.message}`);
            }

            // Emit WebSocket event for real-time updates
            this.eventEmitter.emit('approval.updated', {
                approvalId: updatedApproval.uid,
                approvalReference: updatedApproval.approvalReference,
                type: updatedApproval.type,
                status: updatedApproval.status,
                priority: updatedApproval.priority,
                requesterUid: updatedApproval.requesterUid,
                approverUid: updatedApproval.approverUid,
                title: updatedApproval.title,
                amount: updatedApproval.amount,
                currency: updatedApproval.currency,
                version: updatedApproval.version,
                changes: this.getChanges(originalData, updatedApproval),
                organisationRef: updatedApproval.organisationRef,
                branchUid: updatedApproval.branchUid,
                timestamp: new Date(),
            });

            // Emit real-time notification to mobile/POS/ERP systems
            this.eventEmitter.emit('websocket.broadcast', {
                event: 'approval_updated',
                data: {
                    approvalId: updatedApproval.uid,
                    approvalReference: updatedApproval.approvalReference,
                    type: updatedApproval.type,
                    status: updatedApproval.status,
                    priority: updatedApproval.priority,
                    title: updatedApproval.title,
                    amount: updatedApproval.amount,
                    currency: updatedApproval.currency,
                    version: updatedApproval.version,
                },
                targetRoles: ['admin', 'manager', 'approver'],
                targetUsers: [updatedApproval.requesterUid, updatedApproval.approverUid].filter(Boolean),
                organisationRef: updatedApproval.organisationRef,
                branchUid: updatedApproval.branchUid,
            });

            const executionTime = Date.now() - startTime;
            this.logger.log(`🎉 [update] Approval ${id} updated successfully in ${executionTime}ms`);

            return updatedApproval;

        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`❌ [update] Failed to update approval ${id} after ${executionTime}ms: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Submit approval for review
    async submitForReview(id: number, user: RequestUser) {
        try {
            this.logger.log(`Submitting approval ${id} for review by user ${user.uid}`);

            const approval = await this.findOne(id, user);

            if (approval.status !== ApprovalStatus.DRAFT) {
                throw new BadRequestException('Only draft approvals can be submitted for review');
            }

            if (approval.requesterUid !== user.uid) {
                throw new ForbiddenException('Only the requester can submit this approval');
            }

            // Update status
            approval.status = ApprovalStatus.PENDING;
            approval.submittedAt = new Date();

            const updatedApproval = await this.approvalRepository.save(approval);

            // Create history entry
            await this.createHistoryEntry(
                approval.uid,
                ApprovalAction.SUBMIT,
                ApprovalStatus.DRAFT,
                ApprovalStatus.PENDING,
                user.uid,
                'Approval submitted for review'
            );

            // Send notification to approver
            await this.sendApprovalNotification(approval, 'submitted');

            // Send push notification to approver
            try {
                if (approval.approverUid) {
                    // Get requester name from database
                    const requester = await this.userRepository.findOne({
                        where: { uid: user.uid },
                        select: ['name', 'surname']
                    });
                    const requesterName = requester ? `${requester.name} ${requester.surname}`.trim() : 'Team Member';

                    await this.sendApprovalPushNotification(
                        updatedApproval,
                        'APPROVAL_SUBMITTED',
                        [approval.approverUid],
                        {
                            action: 'submitted',
                            requesterName,
                            message: `Approval request submitted for your review: ${approval.title}`,
                        }
                    );
                }
            } catch (pushError) {
                this.logger.warn(`⚠️ [submitForReview] Failed to send push notification: ${pushError.message}`);
            }

            this.logger.log(`Approval ${id} submitted for review successfully`);

            return {
                uid: updatedApproval.uid,
                status: updatedApproval.status,
                submittedAt: updatedApproval.submittedAt,
                message: 'Approval submitted for review successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to submit approval ${id}: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Perform action on approval
    async performAction(id: number, actionDto: ApprovalActionDto, user: RequestUser) {
        const startTime = Date.now();
        this.logger.log(`⚡ [performAction] Performing action ${actionDto.action} on approval ${id} by user ${user.uid}`);
        
        try {
            this.logger.debug(`📋 [performAction] Action details: ${JSON.stringify(actionDto)}`);

            const approval = await this.findOne(id, user);

            // Validate user can perform this action
            await this.validateActionPermissions(approval, actionDto.action, user);

            const fromStatus = approval.status;
            let toStatus = fromStatus;
            let actionDescription = '';

            // Process the action
            switch (actionDto.action) {
                case ApprovalAction.APPROVE:
                    toStatus = ApprovalStatus.APPROVED;
                    approval.status = toStatus;
                    approval.approvedAt = new Date();
                    approval.approvalComments = actionDto.comments;
                    approval.approvedCount += 1;
                    actionDescription = `Approval approved by user ${user.uid}`;
                    this.logger.log(`✅ [performAction] Approval ${id} approved by user ${user.uid}`);
                    break;

                case ApprovalAction.REJECT:
                    toStatus = ApprovalStatus.REJECTED;
                    approval.status = toStatus;
                    approval.rejectedAt = new Date();
                    approval.rejectionReason = actionDto.reason;
                    approval.rejectedCount += 1;
                    actionDescription = `Approval rejected by user ${user.uid}: ${actionDto.reason}`;
                    this.logger.log(`❌ [performAction] Approval ${id} rejected by user ${user.uid}: ${actionDto.reason}`);
                    break;

                case ApprovalAction.REQUEST_INFO:
                    toStatus = ApprovalStatus.ADDITIONAL_INFO_REQUIRED;
                    approval.status = toStatus;
                    actionDescription = `Additional information requested by user ${user.uid}`;
                    this.logger.log(`📝 [performAction] Additional info requested for approval ${id} by user ${user.uid}`);
                    break;

                case ApprovalAction.DELEGATE:
                    if (!actionDto.delegateToUid) {
                        throw new BadRequestException('Delegate user ID is required');
                    }
                    approval.delegatedFromUid = user.uid;
                    approval.delegatedToUid = actionDto.delegateToUid;
                    actionDescription = `Approval delegated from user ${user.uid} to user ${actionDto.delegateToUid}`;
                    this.logger.log(`🔄 [performAction] Approval ${id} delegated from user ${user.uid} to user ${actionDto.delegateToUid}`);
                    break;

                case ApprovalAction.ESCALATE:
                    if (!actionDto.escalateToUid) {
                        throw new BadRequestException('Escalation user ID is required');
                    }
                    toStatus = ApprovalStatus.ESCALATED;
                    approval.status = toStatus;
                    approval.isEscalated = true;
                    approval.escalatedAt = new Date();
                    approval.escalatedToUid = actionDto.escalateToUid;
                    approval.escalationReason = actionDto.reason;
                    actionDescription = `Approval escalated from user ${user.uid} to user ${actionDto.escalateToUid}: ${actionDto.reason}`;
                    this.logger.log(`⬆️ [performAction] Approval ${id} escalated from user ${user.uid} to user ${actionDto.escalateToUid}`);
                    break;

                default:
                    throw new BadRequestException(`Unsupported action: ${actionDto.action}`);
            }

            this.logger.debug(`💾 [performAction] Saving approval with new status: ${fromStatus} → ${toStatus}`);
            const updatedApproval = await this.approvalRepository.save(approval);

            // Create history entry
            await this.createHistoryEntry(
                approval.uid,
                actionDto.action,
                fromStatus,
                toStatus,
                user.uid,
                actionDto.comments || actionDto.reason || actionDescription
            );

            // Clear relevant caches
            await this.invalidateApprovalCache(updatedApproval);

            // Send notifications
            if (actionDto.sendNotification !== false) {
                this.logger.debug(`📧 [performAction] Sending notification emails for action: ${actionDto.action}`);
                
                // Map approval actions to notification types
                let notificationType: 'created' | 'submitted' | 'approved' | 'rejected' | 'escalated' | null = null;
                switch (actionDto.action) {
                    case ApprovalAction.APPROVE:
                        notificationType = 'approved';
                        break;
                    case ApprovalAction.REJECT:
                        notificationType = 'rejected';
                        break;
                    case ApprovalAction.ESCALATE:
                        notificationType = 'escalated';
                        break;
                    default:
                        // For other actions like REQUEST_INFO, DELEGATE, don't send notifications
                        notificationType = null;
                        break;
                }
                
                if (notificationType) {
                    await this.sendApprovalNotification(approval, notificationType);
                }
            }

            // Send push notifications based on action
            this.logger.debug(`📱 [performAction] Sending push notifications for action: ${actionDto.action}`);
            try {
                let pushRecipients: number[] = [];
                let pushEvent = '';
                let pushMessage = '';

                switch (actionDto.action) {
                    case ApprovalAction.APPROVE:
                        pushRecipients = [updatedApproval.requesterUid];
                        pushEvent = 'APPROVAL_APPROVED';
                        pushMessage = `Your approval request "${updatedApproval.title}" has been approved`;
                        break;

                    case ApprovalAction.REJECT:
                        pushRecipients = [updatedApproval.requesterUid];
                        pushEvent = 'APPROVAL_REJECTED';
                        pushMessage = `Your approval request "${updatedApproval.title}" has been rejected`;
                        break;

                    case ApprovalAction.REQUEST_INFO:
                        pushRecipients = [updatedApproval.requesterUid];
                        pushEvent = 'APPROVAL_INFO_REQUESTED';
                        pushMessage = `Additional information requested for "${updatedApproval.title}"`;
                        break;

                    case ApprovalAction.DELEGATE:
                        if (actionDto.delegateToUid) {
                            pushRecipients = [actionDto.delegateToUid];
                            pushEvent = 'APPROVAL_DELEGATED';
                            pushMessage = `Approval request "${updatedApproval.title}" has been delegated to you`;
                        }
                        break;

                    case ApprovalAction.ESCALATE:
                        if (actionDto.escalateToUid) {
                            pushRecipients = [actionDto.escalateToUid];
                            pushEvent = 'APPROVAL_ESCALATED';
                            pushMessage = `Approval request "${updatedApproval.title}" has been escalated to you`;
                        }
                        break;
                }

                if (pushRecipients.length > 0 && pushEvent) {
                    // Get action performer name from database
                    const actionUser = await this.userRepository.findOne({
                        where: { uid: user.uid },
                        select: ['name', 'surname']
                    });
                    const actionByName = actionUser ? `${actionUser.name} ${actionUser.surname}`.trim() : 'Team Member';

                    await this.sendApprovalPushNotification(
                        updatedApproval,
                        pushEvent,
                        pushRecipients,
                        {
                            action: actionDto.action,
                            actionBy: actionByName,
                            comments: actionDto.comments,
                            reason: actionDto.reason,
                            message: pushMessage,
                            fromStatus,
                            toStatus,
                        }
                    );
                }
            } catch (pushError) {
                this.logger.warn(`⚠️ [performAction] Failed to send push notifications: ${pushError.message}`);
            }

            // Emit WebSocket event for real-time updates
            this.eventEmitter.emit('approval.action.performed', {
                approvalId: updatedApproval.uid,
                approvalReference: updatedApproval.approvalReference,
                action: actionDto.action,
                fromStatus,
                toStatus,
                actionBy: user.uid,
                actionAt: new Date(),
                comments: actionDto.comments,
                reason: actionDto.reason,
                type: updatedApproval.type,
                priority: updatedApproval.priority,
                organisationRef: updatedApproval.organisationRef,
                branchUid: updatedApproval.branchUid,
                timestamp: new Date(),
            });

            // Emit real-time notification to mobile/POS/ERP systems
            this.eventEmitter.emit('websocket.broadcast', {
                event: `approval_${actionDto.action}`,
                data: {
                    approvalId: updatedApproval.uid,
                    approvalReference: updatedApproval.approvalReference,
                    action: actionDto.action,
                    fromStatus,
                    toStatus,
                    actionBy: user.uid,
                    type: updatedApproval.type,
                    priority: updatedApproval.priority,
                    title: updatedApproval.title,
                    amount: updatedApproval.amount,
                    currency: updatedApproval.currency,
                    requesterUid: updatedApproval.requesterUid,
                    approverUid: updatedApproval.approverUid,
                },
                targetRoles: ['admin', 'manager', 'approver'],
                targetUsers: [
                    updatedApproval.requesterUid, 
                    updatedApproval.approverUid,
                    actionDto.delegateToUid,
                    actionDto.escalateToUid
                ].filter(Boolean),
                organisationRef: updatedApproval.organisationRef,
                branchUid: updatedApproval.branchUid,
            });

            // Special handling for high-priority or high-value approvals
            if (updatedApproval.priority === ApprovalPriority.URGENT || 
                updatedApproval.priority === ApprovalPriority.CRITICAL ||
                (updatedApproval.amount && updatedApproval.amount > 50000)) {
                
                this.eventEmitter.emit('approval.high.priority.action', {
                    approvalId: updatedApproval.uid,
                    action: actionDto.action,
                    priority: updatedApproval.priority,
                    amount: updatedApproval.amount,
                    currency: updatedApproval.currency,
                    actionBy: user.uid,
                    organisationRef: updatedApproval.organisationRef,
                });
            }

            const executionTime = Date.now() - startTime;
            this.logger.log(`🎉 [performAction] Action ${actionDto.action} performed successfully on approval ${id} in ${executionTime}ms`);

            return {
                uid: updatedApproval.uid,
                status: updatedApproval.status,
                action: actionDto.action,
                actionBy: user.uid,
                actionAt: new Date(),
                approvalReference: updatedApproval.approvalReference,
                fromStatus,
                toStatus,
                message: 'Approval action completed successfully'
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`❌ [performAction] Failed to perform action on approval ${id} after ${executionTime}ms: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Sign approval digitally
    async signApproval(id: number, signDto: SignApprovalDto, user: RequestUser) {
        try {
            this.logger.log(`Signing approval ${id} by user ${user.uid}`);

            const approval = await this.findOne(id, user);

            if (approval.status !== ApprovalStatus.APPROVED) {
                throw new BadRequestException('Only approved requests can be signed');
            }

            if (!approval.requiresSignature) {
                throw new BadRequestException('This approval does not require a signature');
            }

            // Create signature record
            const signature = this.signatureRepository.create({
                approvalUid: approval.uid,
                signerUid: user.uid,
                signatureType: signDto.signatureType,
                signatureUrl: signDto.signatureUrl,
                signatureData: signDto.signatureData,
                signedAt: new Date(),
                ipAddress: '127.0.0.1' // TODO: Get actual IP
            });

            await this.signatureRepository.save(signature);

            // Update approval
            approval.isSigned = true;
            approval.signedAt = new Date();
            approval.status = ApprovalStatus.SIGNED;

            const updatedApproval = await this.approvalRepository.save(approval);

            // Create history entry
            await this.createHistoryEntry(
                approval.uid,
                ApprovalAction.SIGN,
                ApprovalStatus.APPROVED,
                ApprovalStatus.SIGNED,
                user.uid,
                'Approval signed digitally'
            );

            // Send push notification for signature completion
            try {
                if (updatedApproval.requesterUid && updatedApproval.requesterUid !== user.uid) {
                    const signer = await this.userRepository.findOne({
                        where: { uid: user.uid },
                        select: ['name', 'surname']
                    });
                    const signerName = signer ? `${signer.name} ${signer.surname}`.trim() : 'Team Member';

                    await this.sendApprovalPushNotification(
                        updatedApproval,
                        'APPROVAL_SIGNED',
                        [updatedApproval.requesterUid],
                        {
                            action: 'signed',
                            signedBy: signerName,
                            message: `Your approval request "${updatedApproval.title}" has been digitally signed`,
                            signatureType: signature.signatureType,
                            signedAt: updatedApproval.signedAt?.toISOString(),
                        }
                    );
                }
            } catch (pushError) {
                this.logger.warn(`⚠️ [signApproval] Failed to send push notification: ${pushError.message}`);
            }

            this.logger.log(`Approval ${id} signed successfully`);

            return {
                uid: updatedApproval.uid,
                isSigned: updatedApproval.isSigned,
                signedAt: updatedApproval.signedAt,
                signatureId: signature.uid,
                message: 'Approval signed successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to sign approval ${id}: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Bulk actions
    async bulkAction(bulkActionDto: BulkApprovalActionDto, user: RequestUser) {
        try {
            this.logger.log(`Performing bulk action ${bulkActionDto.action} on ${bulkActionDto.approvalUids.length} approvals by user ${user.uid}`);

            const results = [];
            let successful = 0;
            let failed = 0;

            for (const approvalUid of bulkActionDto.approvalUids) {
                try {
                    const actionDto: ApprovalActionDto = {
                        action: bulkActionDto.action,
                        comments: bulkActionDto.comments,
                        sendNotification: bulkActionDto.sendNotifications
                    };

                    await this.performAction(approvalUid, actionDto, user);
                    results.push({ uid: approvalUid, success: true, message: 'Action completed successfully' });
                    successful++;
                } catch (error) {
                    results.push({ uid: approvalUid, success: false, message: error.message });
                    failed++;
                }
            }

            this.logger.log(`Bulk action completed: ${successful} successful, ${failed} failed`);

            return {
                processed: bulkActionDto.approvalUids.length,
                successful,
                failed,
                results,
                message: 'Bulk action completed successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to perform bulk action: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get approval history
    async getHistory(id: number, user: RequestUser) {
        try {
            this.logger.log(`Fetching history for approval ${id}`);

            const approval = await this.findOne(id, user);

            const history = await this.historyRepository.find({
                where: { approvalUid: approval.uid },
                relations: ['actionByUser'],
                order: { createdAt: 'ASC' }
            });

            this.logger.log(`Retrieved ${history.length} history entries for approval ${id}`);

            return {
                data: history,
                count: history.length,
                message: 'Approval history retrieved successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to fetch approval history: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get approval signatures
    async getSignatures(id: number, user: RequestUser) {
        try {
            this.logger.log(`Fetching signatures for approval ${id}`);

            const approval = await this.findOne(id, user);

            const signatures = await this.signatureRepository.find({
                where: { approvalUid: approval.uid },
                relations: ['signer'],
                order: { createdAt: 'ASC' }
            });

            this.logger.log(`Retrieved ${signatures.length} signatures for approval ${id}`);

            return {
                data: signatures,
                count: signatures.length,
                message: 'Approval signatures retrieved successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to fetch approval signatures: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Withdraw approval
    async withdraw(id: number, user: RequestUser) {
        try {
            this.logger.log(`Withdrawing approval ${id} by user ${user.uid}`);

            const approval = await this.findOne(id, user);

            if (approval.requesterUid !== user.uid) {
                throw new ForbiddenException('Only the requester can withdraw this approval');
            }

            if (![ApprovalStatus.PENDING, ApprovalStatus.UNDER_REVIEW].includes(approval.status)) {
                throw new BadRequestException('Cannot withdraw approval in current status');
            }

            approval.status = ApprovalStatus.WITHDRAWN;
            const updatedApproval = await this.approvalRepository.save(approval);

            // Create history entry
            await this.createHistoryEntry(
                approval.uid,
                ApprovalAction.WITHDRAW,
                approval.status,
                ApprovalStatus.WITHDRAWN,
                user.uid,
                'Approval withdrawn by requester'
            );

            this.logger.log(`Approval ${id} withdrawn successfully`);

            return {
                uid: updatedApproval.uid,
                status: updatedApproval.status,
                withdrawnAt: new Date(),
                message: 'Approval withdrawn successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to withdraw approval ${id}: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Archive approval
    async archive(id: number, user: RequestUser) {
        try {
            this.logger.log(`Archiving approval ${id} by user ${user.uid}`);

            const approval = await this.findOne(id, user);

            if (![ApprovalStatus.COMPLETED, ApprovalStatus.REJECTED, ApprovalStatus.CANCELLED].includes(approval.status)) {
                throw new BadRequestException('Only completed, rejected, or cancelled approvals can be archived');
            }

            approval.isArchived = true;
            approval.archivedAt = new Date();
            approval.archivedBy = user.uid;

            const updatedApproval = await this.approvalRepository.save(approval);

            this.logger.log(`Approval ${id} archived successfully`);

            return {
                uid: updatedApproval.uid,
                isArchived: updatedApproval.isArchived,
                archivedAt: updatedApproval.archivedAt,
                archivedBy: updatedApproval.archivedBy,
                message: 'Approval archived successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to archive approval ${id}: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Delete approval (soft delete)
    async remove(id: number, user: RequestUser) {
        try {
            this.logger.log(`Deleting approval ${id} by user ${user.uid}`);

            const approval = await this.findOne(id, user);

            approval.isDeleted = true;
            const updatedApproval = await this.approvalRepository.save(approval);

            this.logger.log(`Approval ${id} deleted successfully`);

            return {
                uid: updatedApproval.uid,
                isDeleted: updatedApproval.isDeleted,
                message: 'Approval deleted successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to delete approval ${id}: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Helper methods

    private async validateCreatePermissions(dto: CreateApprovalDto, user: RequestUser): Promise<void> {
        // Add business logic validation here
        if (!user.organisationRef) {
            throw new BadRequestException('User must belong to an organisation');
        }

        // Validate document URLs if provided
        if (dto.supportingDocumentUrls?.length > 0) {
            await this.validateDocumentUrls(dto.supportingDocumentUrls);
        }
    }

    // Document URL validation and processing
    private async validateDocumentUrls(urls: string[]): Promise<void> {
        const maxUrls = 10;
        if (urls.length > maxUrls) {
            throw new BadRequestException(`Maximum ${maxUrls} supporting documents allowed`);
        }

        for (const url of urls) {
            if (!this.isValidDocumentUrl(url)) {
                throw new BadRequestException(`Invalid document URL: ${url}`);
            }

            // Check if it's an internal file URL and validate access
            if (this.isInternalDocumentUrl(url)) {
                const isAccessible = await this.validateInternalDocumentAccess(url);
                if (!isAccessible) {
                    throw new BadRequestException(`Document not accessible: ${url}`);
                }
            }
        }
    }

    private isValidDocumentUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);
            // Allow http, https, and file protocols
            const allowedProtocols = ['http:', 'https:', 'file:'];
            if (!allowedProtocols.includes(urlObj.protocol)) {
                return false;
            }

            // Basic URL structure validation
            return Boolean(urlObj.hostname && urlObj.pathname);
        } catch (error) {
            return false;
        }
    }

    private isInternalDocumentUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);
            const internalDomains = [
                process.env.DOCUMENT_STORAGE_DOMAIN,
                process.env.CLIENT_URL?.replace(/^https?:\/\//, ''),
                'localhost',
                '127.0.0.1'
            ].filter(Boolean);

            return internalDomains.some(domain => urlObj.hostname.includes(domain));
        } catch (error) {
            return false;
        }
    }

    private async validateInternalDocumentAccess(url: string): Promise<boolean> {
        try {
            // For internal URLs, we might want to:
            // 1. Check if file exists in our storage
            // 2. Validate user has access to the document
            // 3. Ensure document is not corrupted
            
            // This is a placeholder - implement based on your document storage strategy
            this.logger.log(`Validating internal document access: ${url}`);
            
            // For now, assume internal documents are valid
            // In production, implement actual validation logic
            return true;
        } catch (error) {
            this.logger.error(`Failed to validate document access: ${url}`, error);
            return false;
        }
    }

    private processDocumentUrls(documents: string[] | undefined): string[] {
        if (!documents || !Array.isArray(documents)) {
            return [];
        }

        return documents
            .filter(url => url && typeof url === 'string' && url.trim().length > 0)
            .map(url => url.trim())
            .slice(0, 10); // Enforce maximum limit
    }

    // Comprehensive scoping helper
    private applyScopingFilters(queryBuilder: SelectQueryBuilder<Approval>, user: RequestUser, alias: string = 'approval'): void {
        // Organization scoping - ALWAYS required
        queryBuilder.andWhere(`${alias}.organisationRef = :orgRef`, { 
            orgRef: user.organisationRef?.toString() || '' 
        });

        // Branch scoping for non-admin users
        if (user.branch && ![AccessLevel.OWNER, AccessLevel.ADMIN].includes(user.accessLevel)) {
            queryBuilder.andWhere(`${alias}.branchUid = :branchUid`, { 
                branchUid: user.branch.uid 
            });
        }

        // User-level access control for non-elevated users
        if (![AccessLevel.OWNER, AccessLevel.ADMIN, AccessLevel.MANAGER].includes(user.accessLevel)) {
            queryBuilder.andWhere(
                `(${alias}.requesterUid = :userUid OR ${alias}.approverUid = :userUid OR ${alias}.delegatedToUid = :userUid)`,
                { userUid: user.uid }
            );
        }

        // Always exclude soft-deleted records
        queryBuilder.andWhere(`${alias}.isDeleted = :isDeleted`, { isDeleted: false });
    }

    // Helper to fetch full user data for emails
    private async getFullUserData(userUid: number): Promise<User | null> {
        try {
            return await this.userRepository.findOne({
                where: { uid: userUid, isDeleted: false },
                relations: ['organisation', 'branch']
            });
        } catch (error) {
            this.logger.error(`Failed to fetch user data for uid ${userUid}:`, error);
            return null;
        }
    }

    // Email notification methods
    private async sendApprovalNotification(approval: Approval, action: 'created' | 'submitted' | 'approved' | 'rejected' | 'escalated' | 'updated' | 'deleted') {
        try {
            this.logger.log(`Sending ${action} notification for approval ${approval.uid}`);
            
            // Get full requester data
            const requester = await this.getFullUserData(approval.requesterUid);
            if (!requester) {
                this.logger.warn(`Could not find requester data for approval ${approval.uid}`);
                return;
            }

            // Get full approver data if applicable
            let approver = null;
            if (approval.approverUid) {
                approver = await this.getFullUserData(approval.approverUid);
            }

            // Get escalated user data if applicable
            let escalatedTo = null;
            if (approval.escalatedToUid) {
                escalatedTo = await this.getFullUserData(approval.escalatedToUid);
            }

            // Prepare email data
            const emailData = {
                name: '', // Will be set based on recipient
                approvalReference: approval.approvalReference,
                title: approval.title,
                description: approval.description,
                type: approval.type,
                priority: approval.priority,
                status: approval.status,
                requesterName: `${requester.name} ${requester.surname}`.trim(),
                requesterEmail: requester.email,
                approverName: approver ? `${approver.name} ${approver.surname}`.trim() : '',
                approverEmail: approver ? approver.email : '',
                submittedAt: approval.submittedAt,
                deadline: approval.deadline,
                approvedAt: approval.approvedAt,
                rejectedAt: approval.rejectedAt,
                escalatedAt: approval.escalatedAt,
                escalationLevel: approval.escalationLevel,
                escalationReason: approval.escalationReason,
                originalApproverName: approver ? `${approver.name} ${approver.surname}`.trim() : '',
                originalApproverEmail: approver ? approver.email : '',
                escalatedToName: escalatedTo ? `${escalatedTo.name} ${escalatedTo.surname}`.trim() : '',
                approverComments: approval.approvalComments,
                rejectionReason: approval.rejectionReason,
                supportingDocuments: approval.supportingDocuments,
                entityType: approval.entityType,
                entityId: approval.entityId,
                isSigned: approval.isSigned,
                signatureType: approval.signatureType,
                signatureMetadata: approval.signatureMetadata,
                isOverdue: approval.isOverdue,
                isUrgent: approval.isUrgent,
                canResubmit: approval.status === ApprovalStatus.REJECTED,
                implementationNotes: null, // Not yet implemented in Approval entity
                previousComments: approval.approvalComments,
                organizationName: requester.organisation?.name || 'Your Organization',
                branchName: requester.branch?.name,
                approvalUrl: `${process.env.CLIENT_URL}/approvals/${approval.uid}`,
                dashboardUrl: `${process.env.CLIENT_URL}/dashboard`,
                resubmitUrl: `${process.env.CLIENT_URL}/approvals/${approval.uid}/resubmit`,
            };

            // Determine recipients and email type based on action
            const recipients: string[] = [];
            let emailType: EmailType;

            switch (action) {
                case 'created':
                    // Notify approver when approval is created
                    if (approver?.email) {
                        recipients.push(approver.email);
                        emailType = EmailType.APPROVAL_CREATED;
                    }
                    break;
                case 'submitted':
                    if (approver?.email) {
                        recipients.push(approver.email);
                        emailType = EmailType.APPROVAL_SUBMITTED;
                    }
                    break;
                case 'approved':
                    if (requester?.email) {
                        recipients.push(requester.email);
                        emailType = EmailType.APPROVAL_APPROVED;
                    }
                    break;
                case 'rejected':
                    if (requester?.email) {
                        recipients.push(requester.email);
                        emailType = EmailType.APPROVAL_REJECTED;
                    }
                    break;
                case 'escalated':
                    if (escalatedTo?.email) {
                        recipients.push(escalatedTo.email);
                        emailType = EmailType.APPROVAL_ESCALATED;
                    }
                    break;
                case 'updated':
                    // Notify both requester and approver when approval is updated
                    if (requester?.email) {
                        recipients.push(requester.email);
                    }
                    if (approver?.email && approver.email !== requester?.email) {
                        recipients.push(approver.email);
                    }
                    emailType = EmailType.APPROVAL_UPDATED;
                    break;
                case 'deleted':
                    // Notify both requester and approver when approval is deleted
                    if (requester?.email) {
                        recipients.push(requester.email);
                    }
                    if (approver?.email && approver.email !== requester?.email) {
                        recipients.push(approver.email);
                    }
                    emailType = EmailType.APPROVAL_DELETED;
                    break;
            }

            // Send emails to all recipients
            if (recipients.length > 0 && emailType) {
                for (const email of recipients) {
                    const personalizedData = { ...emailData, name: this.getRecipientName(email, requester, approver, escalatedTo) };
                    this.eventEmitter.emit('send.email', emailType, [email], personalizedData);
                }
                this.logger.log(`${action} notification sent to ${recipients.length} recipients for approval ${approval.uid}`);
            }

        } catch (error) {
            this.logger.error(`Failed to send ${action} notification for approval ${approval.uid}:`, error);
        }
    }

    private getRecipientName(email: string, requester: any, approver: any, escalatedTo: any): string {
        if (requester?.email === email) return `${requester.name} ${requester.surname}`.trim();
        if (approver?.email === email) return `${approver.name} ${approver.surname}`.trim();
        if (escalatedTo?.email === email) return `${escalatedTo.name} ${escalatedTo.surname}`.trim();
        return 'Team Member';
    }

    private async getDefaultApprover(type: ApprovalType, user: RequestUser): Promise<User | null> {
        // Logic to find default approver based on type and user's organization/branch
        const approver = await this.userRepository.findOne({
            where: {
                organisationRef: user.organisationRef?.toString() || '',
                accessLevel: In([AccessLevel.MANAGER, AccessLevel.ADMIN, AccessLevel.OWNER]),
                status: 'active',
                isDeleted: false
            }
        });

        return approver;
    }

    private applyUserAccessFiltering(queryBuilder: SelectQueryBuilder<Approval>, user: RequestUser): void {
        // Apply user-level access filtering based on role
        if (![AccessLevel.OWNER, AccessLevel.ADMIN, AccessLevel.MANAGER].includes(user.accessLevel)) {
            queryBuilder.andWhere(
                '(approval.requesterUid = :uid OR approval.approverUid = :uid OR approval.delegatedToUid = :uid)',
                { uid: user.uid }
            );
        }
    }

    private applySearchFilters(queryBuilder: SelectQueryBuilder<Approval>, query: ApprovalQueryDto): void {
        if (query.search) {
            queryBuilder.andWhere(
                '(approval.title LIKE :search OR approval.description LIKE :search OR approval.approvalReference LIKE :search)',
                { search: `%${query.search}%` }
            );
        }

        if (query.type) {
            queryBuilder.andWhere('approval.type = :type', { type: query.type });
        }

        if (query.status) {
            queryBuilder.andWhere('approval.status = :status', { status: query.status });
        }

        if (query.priority) {
            queryBuilder.andWhere('approval.priority = :priority', { priority: query.priority });
        }

        if (query.isOverdue !== undefined) {
            queryBuilder.andWhere('approval.isOverdue = :isOverdue', { isOverdue: query.isOverdue });
        }

        if (query.isUrgent !== undefined) {
            queryBuilder.andWhere('approval.isUrgent = :isUrgent', { isUrgent: query.isUrgent });
        }

        if (query.createdFrom || query.createdTo) {
            if (query.createdFrom && query.createdTo) {
                queryBuilder.andWhere('approval.createdAt BETWEEN :createdFrom AND :createdTo', {
                    createdFrom: query.createdFrom,
                    createdTo: query.createdTo
                });
            } else if (query.createdFrom) {
                queryBuilder.andWhere('approval.createdAt >= :createdFrom', { createdFrom: query.createdFrom });
            } else if (query.createdTo) {
                queryBuilder.andWhere('approval.createdAt <= :createdTo', { createdTo: query.createdTo });
            }
        }

        if (!query.includeDeleted) {
            queryBuilder.andWhere('approval.isDeleted = :isDeleted', { isDeleted: false });
        }
    }

    private async validateApprovalAccess(approval: Approval, user: RequestUser): Promise<void> {
        // Check organization access
        if (approval.organisationRef !== (user.organisationRef?.toString() || '')) {
            throw new ForbiddenException('Access denied to this approval');
        }

        // Check user-level access
        if (![AccessLevel.OWNER, AccessLevel.ADMIN, AccessLevel.MANAGER].includes(user.accessLevel)) {
            const hasAccess = approval.requesterUid === user.uid || 
                            approval.approverUid === user.uid || 
                            approval.delegatedToUid === user.uid;

            if (!hasAccess) {
                throw new ForbiddenException('Access denied to this approval');
            }
        }
    }

    private async validateActionPermissions(approval: Approval, action: ApprovalAction, user: RequestUser): Promise<void> {
        // Check if user can perform this action
        const canApprove = approval.approverUid === user.uid || approval.delegatedToUid === user.uid;
        const isRequester = approval.requesterUid === user.uid;
        const isAdmin = [AccessLevel.ADMIN, AccessLevel.OWNER].includes(user.accessLevel);

        switch (action) {
            case ApprovalAction.APPROVE:
            case ApprovalAction.REJECT:
            case ApprovalAction.REQUEST_INFO:
                if (!canApprove && !isAdmin) {
                    throw new ForbiddenException('You are not authorized to perform this action');
                }
                break;

            case ApprovalAction.WITHDRAW:
                if (!isRequester && !isAdmin) {
                    throw new ForbiddenException('Only the requester can withdraw this approval');
                }
                break;

            case ApprovalAction.DELEGATE:
            case ApprovalAction.ESCALATE:
                if (!canApprove && !isAdmin) {
                    throw new ForbiddenException('You are not authorized to delegate or escalate this approval');
                }
                break;
        }

        // Check approval status
        const validStatuses = this.getValidStatusesForAction(action);
        if (!validStatuses.includes(approval.status)) {
            throw new BadRequestException(`Cannot perform ${action} on approval with status ${approval.status}`);
        }
    }

    private getValidStatusesForAction(action: ApprovalAction): ApprovalStatus[] {
        switch (action) {
            case ApprovalAction.APPROVE:
            case ApprovalAction.REJECT:
            case ApprovalAction.REQUEST_INFO:
            case ApprovalAction.DELEGATE:
            case ApprovalAction.ESCALATE:
                return [ApprovalStatus.PENDING, ApprovalStatus.UNDER_REVIEW];

            case ApprovalAction.WITHDRAW:
                return [ApprovalStatus.PENDING, ApprovalStatus.UNDER_REVIEW, ApprovalStatus.ADDITIONAL_INFO_REQUIRED];

            case ApprovalAction.SIGN:
                return [ApprovalStatus.APPROVED];

            default:
                return [];
        }
    }

    private async createHistoryEntry(
        approvalUid: number,
        action: ApprovalAction,
        fromStatus: ApprovalStatus | null,
        toStatus: ApprovalStatus,
        actionBy: number,
        comments?: string
    ): Promise<void> {
        const history = this.historyRepository.create({
            approvalUid,
            action,
            fromStatus,
            toStatus,
            actionBy,
            comments,
            source: 'web',
            isSystemAction: false
        });

        await this.historyRepository.save(history);
    }
}
