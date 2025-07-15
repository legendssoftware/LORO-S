import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, Between, SelectQueryBuilder } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
    private readonly cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
    private readonly DEFAULT_CACHE_TTL = 300000; // 5 minutes in milliseconds

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
        private readonly eventEmitter: EventEmitter2
    ) {}

    // Create new approval request
    async create(createApprovalDto: CreateApprovalDto, user: RequestUser) {
        try {
            this.logger.log(`Creating new approval request by user ${user.uid}`);

            // Validate requester has permission to create this type of approval
            await this.validateCreatePermissions(createApprovalDto, user);

            // Create approval entity
            const { supportingDocuments, ...approvalData } = createApprovalDto;
            const approval = this.approvalRepository.create({
                ...approvalData,
                requesterUid: user.uid,
                organisationRef: user.organisationRef?.toString() || '',
                branchUid: user.branch?.uid,
                requestSource: 'web',
                status: ApprovalStatus.DRAFT,
                supportingDocuments: supportingDocuments?.map(doc => doc.url) || []
            });

            // Auto-assign approver if not specified
            if (!approval.approverUid) {
                const approver = await this.getDefaultApprover(approval.type, user);
                if (approver) {
                    approval.approverUid = approver.uid;
                }
            }

            const savedApproval = await this.approvalRepository.save(approval);

            // Create initial history entry
            await this.createHistoryEntry(
                savedApproval.uid,
                ApprovalAction.SUBMIT,
                null,
                ApprovalStatus.DRAFT,
                user.uid,
                'Approval request created'
            );

            // Send creation notification email
            await this.sendApprovalNotification(savedApproval, 'created');

            this.logger.log(`Approval request created successfully: ${savedApproval.approvalReference}`);

            return {
                uid: savedApproval.uid,
                title: savedApproval.title,
                type: savedApproval.type,
                status: savedApproval.status,
                approvalReference: savedApproval.approvalReference,
                message: 'Approval request created successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to create approval request: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get all approvals with filtering and pagination
    async findAll(query: ApprovalQueryDto, user: RequestUser) {
        try {
            this.logger.log(`Fetching approvals for user ${user.uid} with filters`);

            const queryBuilder = this.approvalRepository
                .createQueryBuilder('approval')
                .leftJoinAndSelect('approval.requester', 'requester')
                .leftJoinAndSelect('approval.approver', 'approver')
                .leftJoinAndSelect('approval.delegatedTo', 'delegatedTo')
                .leftJoinAndSelect('approval.organisation', 'organisation')
                .leftJoinAndSelect('approval.branch', 'branch');

            // Apply comprehensive scoping (org, branch, user access)
            this.applyScopingFilters(queryBuilder, user);

            // Apply search filters
            this.applySearchFilters(queryBuilder, query);

            // Apply sorting
            const sortBy = query.sortBy || 'createdAt';
            const sortOrder = query.sortOrder || 'DESC';
            queryBuilder.orderBy(`approval.${sortBy}`, sortOrder);

            // Apply pagination
            const page = query.page || 1;
            const limit = Math.min(query.limit || 20, 100);
            const skip = (page - 1) * limit;

            queryBuilder.skip(skip).take(limit);

            // Include additional relations if requested
            if (query.includeHistory) {
                queryBuilder.leftJoinAndSelect('approval.history', 'history');
            }
            if (query.includeSignatures) {
                queryBuilder.leftJoinAndSelect('approval.signatures', 'signatures');
            }

            const [approvals, total] = await queryBuilder.getManyAndCount();

            const totalPages = Math.ceil(total / limit);

            this.logger.log(`Retrieved ${approvals.length} approvals for user ${user.uid}`);

            return {
                data: approvals,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages
                },
                filters: query,
                message: 'Approvals retrieved successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to fetch approvals: ${error.message}`, error.stack);
            throw error;
        }
    }

    // Get pending approvals for current user
    async getPendingApprovals(user: RequestUser) {
        try {
            this.logger.log(`Fetching pending approvals for user ${user.uid}`);

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
            this.applyScopingFilters(queryBuilder, user);

            const approvals = await queryBuilder
                .orderBy('approval.priority', 'DESC')
                .addOrderBy('approval.submittedAt', 'ASC')
                .getMany();

            this.logger.log(`Found ${approvals.length} pending approvals for user ${user.uid}`);

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
        try {
            this.logger.log(`Fetching approval requests for user ${user.uid}`);

            const queryBuilder = this.approvalRepository
                .createQueryBuilder('approval')
                .leftJoinAndSelect('approval.requester', 'requester')
                .leftJoinAndSelect('approval.approver', 'approver')
                .leftJoinAndSelect('approval.delegatedTo', 'delegatedTo')
                .leftJoinAndSelect('approval.organisation', 'organisation')
                .leftJoinAndSelect('approval.branch', 'branch')
                .where('approval.requesterUid = :uid', { uid: user.uid });

            // Apply comprehensive scoping (org, branch, user access)  
            this.applyScopingFilters(queryBuilder, user);

            // Apply search filters if provided
            if (query.search) {
                queryBuilder.andWhere(
                    '(approval.title LIKE :search OR approval.description LIKE :search OR approval.type LIKE :search)',
                    { search: `%${query.search}%` }
                );
            }

            if (query.status) {
                queryBuilder.andWhere('approval.status = :status', { status: query.status });
            }

            if (query.type) {
                queryBuilder.andWhere('approval.type = :type', { type: query.type });
            }

            // Apply sorting
            const sortBy = query.sortBy || 'createdAt';
            const sortOrder = query.sortOrder || 'DESC';
            queryBuilder.orderBy(`approval.${sortBy}`, sortOrder);

            // Apply pagination
            const page = query.page || 1;
            const limit = Math.min(query.limit || 20, 100);
            const skip = (page - 1) * limit;

            const [approvals, total] = await queryBuilder
                .skip(skip)
                .take(limit)
                .getManyAndCount();
            const totalPages = Math.ceil(total / limit);

            this.logger.log(`Retrieved ${approvals.length} approval requests for user ${user.uid}`);

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

    // Get approval statistics
    async getStats(user: RequestUser) {
        try {
            this.logger.log(`Generating approval statistics for user ${user.uid}`);

            // Check cache first
            const cacheKey = this.getCacheKey('stats', user);
            const cachedStats = this.getFromCache(cacheKey);
            if (cachedStats) {
                this.logger.log(`Returning cached statistics for user ${user.uid}`);
                return cachedStats;
            }

            const baseQuery = this.approvalRepository
                .createQueryBuilder('approval');

            // Apply comprehensive scoping for base statistics
            this.applyScopingFilters(baseQuery, user);

            // Get total counts by status
            const statusCounts = await baseQuery
                .select('approval.status', 'status')
                .addSelect('COUNT(*)', 'count')
                .groupBy('approval.status')
                .getRawMany();

            // Process status counts
            const statusMap = statusCounts.reduce((acc, item) => {
                acc[item.status] = parseInt(item.count);
                return acc;
            }, {} as Record<string, number>);

            const total = statusCounts.reduce((sum, item) => sum + parseInt(item.count), 0);
            const pending = statusMap[ApprovalStatus.PENDING] || 0;
            const approved = statusMap[ApprovalStatus.APPROVED] || 0;
            const rejected = statusMap[ApprovalStatus.REJECTED] || 0;

            // Get overdue count separately
            const overdueQuery = this.approvalRepository.createQueryBuilder('approval');
            this.applyScopingFilters(overdueQuery, user);
            const overdue = await overdueQuery
                .andWhere('approval.isOverdue = :overdue', { overdue: true })
                .getCount();

            // Get statistics by type
            const typeQuery = this.approvalRepository.createQueryBuilder('approval');
            this.applyScopingFilters(typeQuery, user);
            const typeStats = await typeQuery
                .select('approval.type', 'type')
                .addSelect('COUNT(*)', 'count')
                .groupBy('approval.type')
                .getRawMany();

            // Get recent activity (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const recentQuery = this.approvalRepository.createQueryBuilder('approval');
            this.applyScopingFilters(recentQuery, user);
            const recentActivity = await recentQuery
                .where('approval.createdAt >= :date', { date: thirtyDaysAgo })
                .getCount();

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
            this.setCache(cacheKey, stats, 120000);

            this.logger.log(`Generated statistics for user ${user.uid}: ${total} total approvals`);
            return stats;

        } catch (error) {
            this.logger.error(`Failed to generate statistics for user ${user.uid}: ${error.message}`, error.stack);
            throw new BadRequestException('Failed to generate approval statistics');
        }
    }

    // Get specific approval by ID
    async findOne(id: number, user: RequestUser) {
        try {
            this.logger.log(`Fetching approval ${id} for user ${user.uid}`);

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
                throw new NotFoundException(`Approval with ID ${id} not found or access denied`);
            }

            // Additional access validation
            await this.validateApprovalAccess(approval, user);

            this.logger.log(`Successfully fetched approval ${id} for user ${user.uid}`);
            return approval;

        } catch (error) {
            if (error instanceof NotFoundException || error instanceof ForbiddenException) {
                throw error;
            }
            this.logger.error(`Failed to fetch approval ${id} for user ${user.uid}: ${error.message}`, error.stack);
            throw new BadRequestException('Failed to fetch approval');
        }
    }

    // Update approval (draft only)
    async update(id: number, updateApprovalDto: UpdateApprovalDto, user: RequestUser) {
        try {
            this.logger.log(`Updating approval ${id} by user ${user.uid}`);

            const approval = await this.findOne(id, user);

            // Only allow updates to draft approvals by the requester
            if (approval.status !== ApprovalStatus.DRAFT) {
                throw new BadRequestException('Cannot modify approval in current status');
            }

            if (approval.requesterUid !== user.uid) {
                throw new ForbiddenException('Only the requester can modify this approval');
            }

            // Update approval
            Object.assign(approval, updateApprovalDto);
            approval.version += 1;

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

            // Send update notification email
            await this.sendApprovalNotification(updatedApproval, 'updated');

            this.logger.log(`Approval ${id} updated successfully`);

            return updatedApproval;

        } catch (error) {
            this.logger.error(`Failed to update approval ${id}: ${error.message}`, error.stack);
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
        try {
            this.logger.log(`Performing action ${actionDto.action} on approval ${id} by user ${user.uid}`);

            const approval = await this.findOne(id, user);

            // Validate user can perform this action
            await this.validateActionPermissions(approval, actionDto.action, user);

            const fromStatus = approval.status;
            let toStatus = fromStatus;

            // Process the action
            switch (actionDto.action) {
                case ApprovalAction.APPROVE:
                    toStatus = ApprovalStatus.APPROVED;
                    approval.status = toStatus;
                    approval.approvedAt = new Date();
                    approval.approvalComments = actionDto.comments;
                    approval.approvedCount += 1;
                    break;

                case ApprovalAction.REJECT:
                    toStatus = ApprovalStatus.REJECTED;
                    approval.status = toStatus;
                    approval.rejectedAt = new Date();
                    approval.rejectionReason = actionDto.reason;
                    approval.rejectedCount += 1;
                    break;

                case ApprovalAction.REQUEST_INFO:
                    toStatus = ApprovalStatus.ADDITIONAL_INFO_REQUIRED;
                    approval.status = toStatus;
                    break;

                case ApprovalAction.DELEGATE:
                    if (!actionDto.delegateToUid) {
                        throw new BadRequestException('Delegate user ID is required');
                    }
                    approval.delegatedFromUid = user.uid;
                    approval.delegatedToUid = actionDto.delegateToUid;
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
                    break;

                default:
                    throw new BadRequestException(`Unsupported action: ${actionDto.action}`);
            }

            const updatedApproval = await this.approvalRepository.save(approval);

            // Create history entry
            await this.createHistoryEntry(
                approval.uid,
                actionDto.action,
                fromStatus,
                toStatus,
                user.uid,
                actionDto.comments || actionDto.reason
            );

            // Send notifications
            if (actionDto.sendNotification !== false) {
                // Map approval actions to notification types
                let notificationType: 'created' | 'submitted' | 'approved' | 'rejected' | 'escalated';
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

            this.logger.log(`Action ${actionDto.action} performed successfully on approval ${id}`);

            return {
                uid: updatedApproval.uid,
                status: updatedApproval.status,
                action: actionDto.action,
                actionBy: user.uid,
                actionAt: new Date(),
                message: 'Approval action completed successfully'
            };

        } catch (error) {
            this.logger.error(`Failed to perform action on approval ${id}: ${error.message}`, error.stack);
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

    // Cache helper methods
    private getCacheKey(prefix: string, user: RequestUser, ...params: any[]): string {
        return `${prefix}:${user.organisationRef}:${user.uid}:${params.join(':')}`;
    }

    private getFromCache<T>(key: string): T | null {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() - cached.timestamp > cached.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data as T;
    }

    private setCache<T>(key: string, data: T, ttl: number = this.DEFAULT_CACHE_TTL): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    private invalidateUserCache(user: RequestUser): void {
        const userPrefix = `${user.organisationRef}:${user.uid}`;
        for (const [key] of this.cache) {
            if (key.includes(userPrefix)) {
                this.cache.delete(key);
            }
        }
    }

    private invalidateOrgCache(organisationRef: string): void {
        for (const [key] of this.cache) {
            if (key.includes(organisationRef)) {
                this.cache.delete(key);
            }
        }
    }
}
