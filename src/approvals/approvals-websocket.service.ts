import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ShopGateway } from '../shop/shop.gateway';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Approval } from './entities/approval.entity';
import { User } from '../user/entities/user.entity';

@Injectable()
export class ApprovalsWebSocketService {
    private readonly logger = new Logger(ApprovalsWebSocketService.name);

    constructor(
        private readonly shopGateway: ShopGateway,
        @InjectRepository(Approval)
        private readonly approvalRepository: Repository<Approval>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    /**
     * 🆕 Handle approval created events
     */
    @OnEvent('approval.created')
    async handleApprovalCreated(data: any) {
        try {
            this.logger.log(`🆕 [handleApprovalCreated] Processing approval created event: ${data.approvalId}`);

            // Get full approval data with all relations
            const approval = await this.getFullApprovalData(data.approvalId);
            if (!approval) {
                this.logger.warn(`⚠️ [handleApprovalCreated] Approval not found: ${data.approvalId}`);
                return;
            }

            const payload = await this.buildApprovalPayload(approval, 'created', data);

            // Broadcast to all connected clients
            this.shopGateway.server.emit('approval:created', payload);
            this.logger.log(`🆕 Approval created event broadcasted: ${approval.approvalReference}`);

        } catch (error) {
            this.logger.error(`❌ [handleApprovalCreated] Error handling approval created event:`, error.message);
        }
    }

    /**
     * 🔄 Handle approval updated events
     */
    @OnEvent('approval.updated')
    async handleApprovalUpdated(data: any) {
        try {
            this.logger.log(`🔄 [handleApprovalUpdated] Processing approval updated event: ${data.approvalId}`);

            // Get full approval data with all relations
            const approval = await this.getFullApprovalData(data.approvalId);
            if (!approval) {
                this.logger.warn(`⚠️ [handleApprovalUpdated] Approval not found: ${data.approvalId}`);
                return;
            }

            const payload = await this.buildApprovalPayload(approval, 'updated', data);

            // Broadcast to all connected clients
            this.shopGateway.server.emit('approval:updated', payload);
            this.logger.log(`🔄 Approval updated event broadcasted: ${approval.approvalReference}`);

        } catch (error) {
            this.logger.error(`❌ [handleApprovalUpdated] Error handling approval updated event:`, error.message);
        }
    }

    /**
     * ⚡ Handle approval action performed events
     */
    @OnEvent('approval.action.performed')
    async handleApprovalActionPerformed(data: any) {
        try {
            this.logger.log(`⚡ [handleApprovalActionPerformed] Processing approval action: ${data.action} on ${data.approvalId}`);

            // Get full approval data with all relations
            const approval = await this.getFullApprovalData(data.approvalId);
            if (!approval) {
                this.logger.warn(`⚠️ [handleApprovalActionPerformed] Approval not found: ${data.approvalId}`);
                return;
            }

            const payload = await this.buildApprovalPayload(approval, 'action_performed', data);

            // Broadcast to all connected clients
            this.shopGateway.server.emit('approval:action', payload);
            this.logger.log(`⚡ Approval action event broadcasted: ${approval.approvalReference} - ${data.action}`);

        } catch (error) {
            this.logger.error(`❌ [handleApprovalActionPerformed] Error handling approval action event:`, error.message);
        }
    }

    /**
     * 🚨 Handle high priority approval actions
     */
    @OnEvent('approval.high.priority.action')
    async handleHighPriorityApprovalAction(data: any) {
        try {
            this.logger.log(`🚨 [handleHighPriorityApprovalAction] Processing high priority action on: ${data.approvalId}`);

            // Get full approval data with all relations
            const approval = await this.getFullApprovalData(data.approvalId);
            if (!approval) {
                this.logger.warn(`⚠️ [handleHighPriorityApprovalAction] Approval not found: ${data.approvalId}`);
                return;
            }

            const payload = await this.buildApprovalPayload(approval, 'high_priority_action', data);

            // Broadcast to all connected clients with priority flag
            this.shopGateway.server.emit('approval:high-priority', payload);
            this.logger.log(`🚨 High priority approval event broadcasted: ${approval.approvalReference}`);

        } catch (error) {
            this.logger.error(`❌ [handleHighPriorityApprovalAction] Error handling high priority approval action:`, error.message);
        }
    }

    /**
     * 📊 Handle general websocket broadcast events
     */
    @OnEvent('websocket.broadcast')
    async handleWebSocketBroadcast(data: any) {
        try {
            this.logger.log(`📊 [handleWebSocketBroadcast] Processing broadcast event: ${data.event}`);

            // Emit the event with the provided data
            this.shopGateway.server.emit(data.event, {
                ...data.data,
                timestamp: data.timestamp || new Date(),
                event: data.event,
            });

            this.logger.log(`📊 WebSocket broadcast emitted: ${data.event}`);

        } catch (error) {
            this.logger.error(`❌ [handleWebSocketBroadcast] Error handling websocket broadcast:`, error.message);
        }
    }

    /**
     * 🏗️ Build comprehensive approval payload for websocket events
     */
    private async buildApprovalPayload(approval: Approval, eventType: string, eventData: any) {
        // Get additional user data if available
        let actionByUser = null;
        if (eventData.actionBy) {
            actionByUser = await this.userRepository.findOne({
                where: { uid: eventData.actionBy },
                select: ['uid', 'name', 'surname', 'email', 'accessLevel'],
            });
        }

        return {
            // Event metadata
            event: eventType,
            timestamp: new Date(),
            
            // Core approval data
            approval: {
                uid: approval.uid,
                approvalReference: approval.approvalReference,
                title: approval.title,
                description: approval.description,
                type: approval.type,
                status: approval.status,
                priority: approval.priority,
                amount: approval.amount,
                currency: approval.currency,
                deadline: approval.deadline,
                isUrgent: approval.isUrgent,
                isOverdue: approval.isOverdue,
                isEscalated: approval.isEscalated,
                escalationLevel: approval.escalationLevel,
                escalationReason: approval.escalationReason,
                escalatedAt: approval.escalatedAt,
                entityType: approval.entityType,
                entityId: approval.entityId,
                approvalComments: approval.approvalComments,
                rejectionReason: approval.rejectionReason,
                supportingDocuments: approval.supportingDocuments,
                requiresSignature: approval.requiresSignature,
                isSigned: approval.isSigned,
                signedAt: approval.signedAt,
                signatureType: approval.signatureType,
                submittedAt: approval.submittedAt,
                approvedAt: approval.approvedAt,
                rejectedAt: approval.rejectedAt,
                version: approval.version,
                approvedCount: approval.approvedCount,
                rejectedCount: approval.rejectedCount,
                createdAt: approval.createdAt,
                updatedAt: approval.updatedAt,
            },

            // Related entities
            requester: approval.requester ? {
                uid: approval.requester.uid,
                name: approval.requester.name,
                surname: approval.requester.surname,
                email: approval.requester.email,
                accessLevel: approval.requester.accessLevel,
                photoURL: approval.requester.photoURL,
            } : null,

            approver: approval.approver ? {
                uid: approval.approver.uid,
                name: approval.approver.name,
                surname: approval.approver.surname,
                email: approval.approver.email,
                accessLevel: approval.approver.accessLevel,
                photoURL: approval.approver.photoURL,
            } : null,

            delegatedTo: approval.delegatedTo ? {
                uid: approval.delegatedTo.uid,
                name: approval.delegatedTo.name,
                surname: approval.delegatedTo.surname,
                email: approval.delegatedTo.email,
                accessLevel: approval.delegatedTo.accessLevel,
            } : null,

            delegatedFrom: approval.delegatedFrom ? {
                uid: approval.delegatedFrom.uid,
                name: approval.delegatedFrom.name,
                surname: approval.delegatedFrom.surname,
                email: approval.delegatedFrom.email,
                accessLevel: approval.delegatedFrom.accessLevel,
            } : null,

            escalatedTo: approval.escalatedTo ? {
                uid: approval.escalatedTo.uid,
                name: approval.escalatedTo.name,
                surname: approval.escalatedTo.surname,
                email: approval.escalatedTo.email,
                accessLevel: approval.escalatedTo.accessLevel,
            } : null,

            organisation: approval.organisation ? {
                uid: approval.organisation.uid,
                name: approval.organisation.name,
                ref: approval.organisation.ref,
            } : null,

            // Event-specific data
            action: eventData.action || null,
            actionBy: actionByUser,
            fromStatus: eventData.fromStatus || null,
            toStatus: eventData.toStatus || null,
            comments: eventData.comments || null,
            reason: eventData.reason || null,
            changes: eventData.changes || null,

            // Additional metadata
            organisationRef: approval.organisationRef,
            targetUsers: eventData.targetUsers || [],
            targetRoles: eventData.targetRoles || [],
        };
    }

    /**
     * 🔍 Get full approval data with all relations
     */
    private async getFullApprovalData(approvalId: number): Promise<Approval | null> {
        try {
            return await this.approvalRepository.findOne({
                where: { uid: approvalId },
                relations: [
                    'requester',
                    'approver',
                    'delegatedTo',
                    'delegatedFrom',
                    'escalatedTo',
                    'organisation',
                    'history',
                    'signatures',
                ],
            });
        } catch (error) {
            this.logger.error(`❌ [getFullApprovalData] Error fetching approval data: ${error.message}`);
            return null;
        }
    }

    /**
     * 🔔 Emit approval metrics for dashboard updates
     */
    async emitApprovalMetrics(orgId?: number) {
        try {
            // Build query for metrics (org-scoped only; no branch)
            const queryBuilder = this.approvalRepository.createQueryBuilder('approval');
            
            if (orgId) {
                queryBuilder.andWhere('approval.organisationRef = :orgRef', { orgRef: orgId.toString() });
            }

            // Get basic metrics
            const [totalCount, pendingCount, overdueCount, urgentCount] = await Promise.all([
                queryBuilder.getCount(),
                queryBuilder.clone().andWhere('approval.status = :status', { status: 'PENDING' }).getCount(),
                queryBuilder.clone().andWhere('approval.isOverdue = :overdue', { overdue: true }).getCount(),
                queryBuilder.clone().andWhere('approval.isUrgent = :urgent', { urgent: true }).getCount(),
            ]);

            const metrics = {
                total: totalCount,
                pending: pendingCount,
                overdue: overdueCount,
                urgent: urgentCount,
                timestamp: new Date(),
                scope: {
                    organisationId: orgId || null,
                },
            };

            // Broadcast metrics update
            this.shopGateway.broadcastAnalyticsUpdate({
                type: 'approval-metrics',
                data: metrics,
                timestamp: new Date(),
            });

            this.logger.debug(`📊 Approval metrics broadcasted: ${totalCount} total, ${pendingCount} pending`);

        } catch (error) {
            this.logger.error(`❌ [emitApprovalMetrics] Error emitting approval metrics:`, error.message);
        }
    }
} 