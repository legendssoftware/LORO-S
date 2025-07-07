import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateRewardDto } from './dto/create-reward.dto';
import { UserRewards } from './entities/user-rewards.entity';
import { XPTransaction } from './entities/xp-transaction.entity';
import { LEVELS, RANKS } from '../lib/constants/constants';

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    @InjectRepository(UserRewards)
    private userRewardsRepository: Repository<UserRewards>,
    @InjectRepository(XPTransaction)
    private xpTransactionRepository: Repository<XPTransaction>
  ) { }

  async awardXP(createRewardDto: CreateRewardDto, orgId?: number, branchId?: number) {
    const logPrefix = `[awardXP] Awarding ${createRewardDto.amount}XP to user ${createRewardDto.owner}`;
    
    try {
      this.logger.log(`${logPrefix} - Starting awardXP process`);
      this.logger.log(`${logPrefix} - Action: ${createRewardDto.action}, Source: ${createRewardDto.source.type}`);
      this.logger.log(`${logPrefix} - Organization: ${orgId}, Branch: ${branchId}`);
      
      if (!orgId) {
        this.logger.error(`${logPrefix} - Missing organization ID`);
        throw new BadRequestException('Organization ID is required');
      }

      // Build where clause for organization and branch filtering
      const whereClause: any = {
        owner: { uid: createRewardDto.owner },
      };

      if (branchId) {
        this.logger.log(`${logPrefix} - Adding branch filter: branchId=${branchId}`);
        whereClause.owner.branch = { uid: branchId };
      }

      this.logger.log(`${logPrefix} - Query whereClause:`, JSON.stringify(whereClause, null, 2));

      let userRewards = await this.userRewardsRepository.findOne({
        where: whereClause,
        relations: ['owner', 'owner.branch']
      });

      if (!userRewards) {
        this.logger.log(`${logPrefix} - No existing rewards record found, creating new one`);
        
        // Verify user exists in the organization before creating rewards
        const userExists = await this.userRewardsRepository.manager.query(
          `SELECT u.uid FROM users u WHERE u.uid = ? AND u.organisationRef = ? ${branchId ? 'AND u.branchUid = ?' : ''}`,
          branchId ? [createRewardDto.owner, orgId, branchId] : [createRewardDto.owner, orgId]
        );

        this.logger.log(`${logPrefix} - User verification query result:`, userExists);

        if (!userExists || userExists.length === 0) {
          this.logger.error(`${logPrefix} - User not found in organization ${orgId}`);
          throw new NotFoundException('User not found in your organization');
        }

        this.logger.log(`${logPrefix} - Creating new rewards record for user`);
        userRewards = this.userRewardsRepository.create({
          owner: { uid: createRewardDto.owner },
          xpBreakdown: {
            tasks: 0,
            leads: 0,
            sales: 0,
            attendance: 0,
            collaboration: 0,
            login: 0,
            other: 0
          }
        });
        userRewards = await this.userRewardsRepository.save(userRewards);
        this.logger.log(`${logPrefix} - Created new rewards record with UID: ${userRewards.uid}`);
      } else {
        this.logger.log(`${logPrefix} - Found existing rewards record with UID: ${userRewards.uid}`);
      }

      // Create XP transaction
      this.logger.log(`${logPrefix} - Creating XP transaction`);
      const transaction = this.xpTransactionRepository.create({
        userRewards,
        action: createRewardDto.action,
        xpAmount: createRewardDto.amount,
        metadata: {
          sourceId: createRewardDto.source.id,
          sourceType: createRewardDto.source.type,
          details: createRewardDto.source.details
        }
      });

      await this.xpTransactionRepository.save(transaction);
      this.logger.log(`${logPrefix} - Saved XP transaction with ID: ${transaction.uid}`);

      // Update XP breakdown
      const category = this.mapSourceTypeToCategory(createRewardDto.source.type);
      this.logger.log(`${logPrefix} - Mapping source type '${createRewardDto.source.type}' to category '${category}'`);
      
      // Ensure xpBreakdown has all required fields (for backwards compatibility)
      const requiredFields = ['tasks', 'leads', 'sales', 'attendance', 'collaboration', 'login', 'other'];
      requiredFields.forEach(field => {
        if (!userRewards.xpBreakdown[field] && userRewards.xpBreakdown[field] !== 0) {
          userRewards.xpBreakdown[field] = 0;
        }
      });
      
      const oldValues = {
        currentXP: userRewards.currentXP,
        totalXP: userRewards.totalXP,
        level: userRewards.level,
        rank: userRewards.rank,
        categoryXP: userRewards.xpBreakdown[category]
      };

      userRewards.xpBreakdown[category] += createRewardDto.amount;
      userRewards.currentXP += createRewardDto.amount;
      userRewards.totalXP += createRewardDto.amount;

      // Check for level up
      const newLevel = this.calculateLevel(userRewards.totalXP);
      if (newLevel > userRewards.level) {
        this.logger.log(`${logPrefix} - Level up detected! Old level: ${userRewards.level}, New level: ${newLevel}`);
        userRewards.level = newLevel;
        userRewards.rank = this.calculateRank(newLevel);
        this.logger.log(`${logPrefix} - New rank: ${userRewards.rank}`);
      }

      this.logger.log(`${logPrefix} - XP Changes:`, {
        old: oldValues,
        new: {
          currentXP: userRewards.currentXP,
          totalXP: userRewards.totalXP,
          level: userRewards.level,
          rank: userRewards.rank,
          categoryXP: userRewards.xpBreakdown[category]
        }
      });

      await this.userRewardsRepository.save(userRewards);
      this.logger.log(`${logPrefix} - Successfully saved updated rewards`);

      return {
        message: process.env.SUCCESS_MESSAGE,
        rewards: userRewards
      };
    } catch (error) {
      this.logger.error(`${logPrefix} - Error occurred:`, error.message);
      this.logger.error(`${logPrefix} - Error stack:`, error.stack);
      
      return {
        message: error?.message,
        rewards: null
      };
    }
  }

  private mapSourceTypeToCategory(sourceType: string): string {
    const mapping: { [key: string]: string } = {
      login: 'login',
      task: 'task',
      subtask: 'subtask',
      lead: 'lead',
      sale: 'sale',
      collaboration: 'collaboration',
      attendance: 'attendance',
      'check-in-client': 'check-in-client',
      'check-out-client': 'check-out-client',
      claim: 'claim',
      journal: 'journal',
      notification: 'notification'
    };

    // Handle login-related actions
    if (sourceType?.toLowerCase().includes('login')) {
      return 'login';
    }

    return mapping[sourceType] || 'other';
  }

  private calculateLevel(xp: number): number {
    for (const [level, range] of Object.entries(LEVELS)) {
      if (xp >= range?.min && xp <= range?.max) {
        return parseInt(level);
      }
    }
    return 1;
  }

  private calculateRank(level: number): string {
    for (const [rank, range] of Object.entries(RANKS)) {
      if (level >= range?.levels[0] && level <= range?.levels[1]) {
        return rank;
      }
    }
    return 'ROOKIE';
  }

  async getUserRewards(reference: number, orgId?: number, branchId?: number, requestingUserId?: number) {
    const logPrefix = `[getUserRewards] User ${requestingUserId} requesting rewards for user ${reference}`;
    
    try {
      this.logger.log(`${logPrefix} - Starting getUserRewards process`);
      this.logger.log(`${logPrefix} - Parameters: orgId=${orgId}, branchId=${branchId}`);
      
      if (!orgId) {
        this.logger.error(`${logPrefix} - Missing organization ID`);
        throw new BadRequestException('Organization ID is required');
      }

      // Build where clause for organization and branch filtering
      const whereClause: any = {
        owner: { 
          uid: reference,
          organisationRef: orgId
        }
      };

      if (branchId) {
        this.logger.log(`${logPrefix} - Adding branch filter: branchId=${branchId}`);
        whereClause.owner.branch = { uid: branchId };
      }

      this.logger.log(`${logPrefix} - Query whereClause:`, JSON.stringify(whereClause, null, 2));

      // Check if user is requesting their own rewards or has admin permissions
      const isOwnRewards = requestingUserId === reference;
      this.logger.log(`${logPrefix} - Is requesting own rewards: ${isOwnRewards}`);

      this.logger.log(`${logPrefix} - Executing database query...`);
      const userRewards = await this.userRewardsRepository.findOne({
        where: whereClause,
        relations: ['owner', 'owner.organisation', 'owner.branch', 'xpTransactions', 'achievements', 'inventory']
      });

      if (!userRewards) {
        this.logger.warn(`${logPrefix} - No rewards found for user ${reference} in org ${orgId}`);
        throw new NotFoundException(process.env.NOT_FOUND_MESSAGE || 'User rewards not found');
      }

      this.logger.log(`${logPrefix} - Found rewards record with UID: ${userRewards.uid}`);
      this.logger.log(`${logPrefix} - User details:`, {
        userUid: userRewards.owner?.uid,
        orgId: userRewards.owner?.organisationRef,
        branchId: userRewards.owner?.branch?.uid,
        totalXP: userRewards.totalXP,
        level: userRewards.level,
        rank: userRewards.rank
      });

      // Ensure xpBreakdown has all required fields (for backwards compatibility)
      const requiredFields = ['tasks', 'leads', 'sales', 'attendance', 'collaboration', 'login', 'other'];
      requiredFields.forEach(field => {
        if (!userRewards.xpBreakdown[field] && userRewards.xpBreakdown[field] !== 0) {
          userRewards.xpBreakdown[field] = 0;
        }
      });

      // Additional security: users can only see their own rewards unless they're admin
      if (!isOwnRewards) {
        this.logger.warn(`${logPrefix} - Cross-user access: User ${requestingUserId} accessing rewards for user ${reference}`);
        // Here you could add additional role-based checks
        // For now, we'll allow it but you may want to restrict this
      }

      const response = {
        message: process.env.SUCCESS_MESSAGE,
        rewards: userRewards
      };

      this.logger.log(`${logPrefix} - Successfully returning rewards data`);
      return response;
    } catch (error) {
      this.logger.error(`${logPrefix} - Error occurred:`, error.message);
      this.logger.error(`${logPrefix} - Error stack:`, error.stack);
      
      const response = {
        message: error?.message,
        rewards: null
      };

      return response;
    }
  }

  async getLeaderboard(orgId?: number, branchId?: number) {
    const logPrefix = `[getLeaderboard] Fetching leaderboard for org ${orgId}`;
    
    try {
      this.logger.log(`${logPrefix} - Starting getLeaderboard process`);
      this.logger.log(`${logPrefix} - Parameters: orgId=${orgId}, branchId=${branchId}`);
      
      if (!orgId) {
        this.logger.error(`${logPrefix} - Missing organization ID`);
        throw new BadRequestException('Organization ID is required');
      }

      // Build where clause for organization and branch filtering
      const whereClause: any = {
        owner: { 
          organisationRef: orgId
        }
      };

      if (branchId) {
        this.logger.log(`${logPrefix} - Adding branch filter: branchId=${branchId}`);
        whereClause.owner.branch = { uid: branchId };
      }

      this.logger.log(`${logPrefix} - Query whereClause:`, JSON.stringify(whereClause, null, 2));

      const leaderboard = await this.userRewardsRepository.find({
        where: whereClause,
        relations: ['owner', 'owner.branch'],
        order: {
          totalXP: 'DESC'
        },
        take: 10
      });

      this.logger.log(`${logPrefix} - Found ${leaderboard.length} entries for leaderboard`);

      const response = {
        message: process.env.SUCCESS_MESSAGE,
        rewards: leaderboard.map(entry => ({
          owner: { uid: entry?.owner?.uid },
          username: entry?.owner?.username,
          totalXP: entry?.totalXP,
          level: entry?.level,
          rank: entry?.rank
        }))
      }

      this.logger.log(`${logPrefix} - Successfully returning leaderboard data`);
      return response;
    } catch (error) {
      this.logger.error(`${logPrefix} - Error occurred:`, error.message);
      this.logger.error(`${logPrefix} - Error stack:`, error.stack);
      
      const response = {
        message: error?.message,
        rewards: null
      };

      return response;
    }
  }
}
