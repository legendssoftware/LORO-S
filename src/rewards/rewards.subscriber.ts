import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RewardsService } from './rewards.service';
import { XP_VALUES } from '../lib/constants/constants';

@Injectable()
export class RewardsSubscriber {
    constructor(private readonly rewardsService: RewardsService) { }

    @OnEvent('task.created')
    handleTaskCreated(payload: { taskId?: string; userId?: number; orgId?: number; branchId?: number; task?: any }) {
        // Handle new format: { taskId, userId, orgId, branchId }
        if (payload.userId && payload.taskId) {
            this.rewardsService.awardXP({
                owner: payload.userId,
                action: 'CREATE_TASK',
                amount: XP_VALUES.CREATE_TASK,
                source: {
                    id: payload.taskId,
                    type: 'task'
                }
            }, payload.orgId, payload.branchId);
            return;
        }
        
        // Handle legacy format: { task: Task }
        if (payload.task) {
            const creatorId = payload.task.creator?.uid || payload.task.creator?.[0]?.uid;
            const taskId = payload.task.uid?.toString();
            const orgId = payload.task.organisation?.uid || payload.task.organisationRef;
            const branchId = payload.task.branch?.uid;
            
            if (creatorId && taskId) {
                this.rewardsService.awardXP({
                    owner: creatorId,
                    action: 'CREATE_TASK',
                    amount: XP_VALUES.CREATE_TASK,
                    source: {
                        id: taskId,
                        type: 'task'
                    }
                }, orgId, branchId);
            }
        }
    }

    @OnEvent('task.completed')
    handleTaskCompleted(payload: { taskId: string; userId: number; completedEarly: boolean; orgId?: number; branchId?: number }) {
        this.rewardsService.awardXP({
            owner: payload.userId,
            action: payload.completedEarly ? 'COMPLETE_TASK_EARLY' : 'COMPLETE_TASK',
            amount: payload.completedEarly ? XP_VALUES.COMPLETE_TASK_EARLY : XP_VALUES.COMPLETE_TASK,
            source: {
                id: payload.taskId,
                type: 'task',
                details: { completedEarly: payload.completedEarly }
            }
        }, payload.orgId, payload.branchId);
    }

    @OnEvent('lead.created')
    handleLeadCreated(payload: { leadId: string; userId: number; orgId?: number; branchId?: number }) {
        this.rewardsService.awardXP({
            owner: payload.userId,
            action: 'CREATE_LEAD',
            amount: XP_VALUES.CREATE_LEAD,
            source: {
                id: payload.leadId,
                type: 'lead'
            }
        }, payload.orgId, payload.branchId);
    }
} 