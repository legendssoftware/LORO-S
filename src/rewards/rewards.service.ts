import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CreateRewardDto } from './dto/create-reward.dto';
import { UserRewards } from './entities/user-rewards.entity';
import { XPTransaction } from './entities/xp-transaction.entity';
import { User } from '../user/entities/user.entity';
import { LEVELS, RANKS } from '../lib/constants/constants';

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    @InjectRepository(UserRewards)
    private userRewardsRepository: Repository<UserRewards>,
    @InjectRepository(XPTransaction)
    private xpTransactionRepository: Repository<XPTransaction>,
    @InjectDataSource()
    private dataSource: DataSource
  ) { }

  async awardXP(createRewardDto: CreateRewardDto, orgId?: string, branchId?: number) {
    const logPrefix = `[awardXP] Awarding ${createRewardDto.amount}XP to user ${createRewardDto.owner}`;
    
    try {
      if (!createRewardDto.owner) {
        this.logger.warn(`Skipping XP award - user ID is undefined for action: ${createRewardDto.action}`);
        return;
      }

      if (!orgId) {
        throw new BadRequestException('Organization ID is required');
      }

      // Build where clause - don't filter by branch as XP rewards are user-specific
      const whereClause: any = {
        owner: { uid: createRewardDto.owner },
      };

      let userRewards = await this.userRewardsRepository.findOne({
        where: whereClause,
        relations: ['owner', 'owner.branch']
      });

      if (!userRewards) {
        this.logger.log(`${logPrefix} - No existing rewards record found, creating new one`);
        
        // Verify user exists in the organization before creating rewards
        // Use TypeORM query builder to handle column mapping correctly
        // Don't filter by branch - users should be able to receive XP regardless of branch changes
        const userRepository = this.dataSource.getRepository(User);
        const user = await userRepository
          .createQueryBuilder('u')
          .select(['u.uid', 'u.clerkUserId'])
          .where('u.uid = :userId', { userId: createRewardDto.owner })
          .andWhere('u.organisationRef = :orgRef', { orgRef: orgId })
          .getOne();

        this.logger.log(`${logPrefix} - User verification query result:`, user ? { u_uid: user.uid, clerkUserId: user.clerkUserId } : null);

        if (!user || !user.clerkUserId) {
          this.logger.error(`${logPrefix} - User not found in organization ${orgId} or missing clerkUserId`);
          throw new NotFoundException('User not found in your organization');
        }

        this.logger.log(`${logPrefix} - Creating new rewards record for user`);
        // Set both owner relation (with clerkUserId) and ownerClerkUserId explicitly
        userRewards = this.userRewardsRepository.create({
          owner: { clerkUserId: user.clerkUserId } as User,
          ownerClerkUserId: user.clerkUserId, // Explicitly set the foreign key
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

      // Update XP breakdown
      const category = this.mapSourceTypeToCategory(createRewardDto.source.type);
      
      // Ensure xpBreakdown has all required fields (for backwards compatibility)
      const requiredFields = ['tasks', 'leads', 'sales', 'attendance', 'collaboration', 'login', 'other'];
      requiredFields.forEach(field => {
        if (!userRewards.xpBreakdown[field] && userRewards.xpBreakdown[field] !== 0) {
          userRewards.xpBreakdown[field] = 0;
        }
      });

      userRewards.xpBreakdown[category] += createRewardDto.amount;
      userRewards.currentXP += createRewardDto.amount;
      userRewards.totalXP += createRewardDto.amount;

      // Check for level up
      const newLevel = this.calculateLevel(userRewards.totalXP);
      if (newLevel > userRewards.level) {
        this.logger.log(`Level up! User ${createRewardDto.owner}: ${userRewards.level} → ${newLevel} (${userRewards.rank} → ${this.calculateRank(newLevel)})`);
        userRewards.level = newLevel;
        userRewards.rank = this.calculateRank(newLevel);
      }

      await this.userRewardsRepository.save(userRewards);

      return {
        message: process.env.SUCCESS_MESSAGE,
        rewards: userRewards
      };
    } catch (error) {
      this.logger.error(`Failed to award XP: ${error.message}`, error.stack);
      
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

  async getUserRewards(reference: string, orgId?: string, branchId?: number, requestingUserClerkId?: string) {
    const logPrefix = `[getUserRewards] User ${requestingUserClerkId} requesting rewards for user ${reference}`;
    
    try {
      this.logger.log(`${logPrefix} - Starting getUserRewards process`);
      this.logger.log(`${logPrefix} - Parameters: orgId=${orgId}, branchId=${branchId}`);
      
      if (!orgId) {
        this.logger.error(`${logPrefix} - Missing organization ID`);
        throw new BadRequestException('Organization ID is required');
      }

      // Build where clause for organization and branch filtering
      // Use clerkUserId instead of uid since reference is a Clerk user ID string
      const whereClause: any = {
        owner: { 
          clerkUserId: reference,
          organisationRef: orgId
        }
      };

      if (branchId) {
        this.logger.log(`${logPrefix} - Adding branch filter: branchId=${branchId}`);
        whereClause.owner.branch = { uid: branchId };
      }

      this.logger.log(`${logPrefix} - Query whereClause:`, JSON.stringify(whereClause, null, 2));

      // Check if user is requesting their own rewards or has admin permissions
      // Compare clerkUserId strings instead of numeric uid
      const isOwnRewards = requestingUserClerkId && requestingUserClerkId === reference;
      this.logger.log(`${logPrefix} - Is requesting own rewards: ${isOwnRewards}`);

      this.logger.log(`${logPrefix} - Executing database query...`);
      const userRewards = await this.userRewardsRepository.findOne({
        where: whereClause,
        relations: ['owner', 'owner.organisation', 'owner.branch', 'xpTransactions', 'achievements', 'inventory']
      });

      if (!userRewards) {
        this.logger.warn(`${logPrefix} - No rewards found for user ${reference} in org ${orgId}`);
        // Return a proper response instead of throwing an error
        return {
          message: process.env.NOT_FOUND_MESSAGE || 'User rewards not found',
          rewards: null
        };
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
        this.logger.warn(`${logPrefix} - Cross-user access: User ${requestingUserClerkId} accessing rewards for user ${reference}`);
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

      // Get leaderboard with enhanced relations
      const leaderboard = await this.userRewardsRepository.find({
        where: whereClause,
        relations: [
          'owner',
          'owner.branch',
          'owner.organisation',
          'xpTransactions',
          'achievements'
        ],
        order: {
          totalXP: 'DESC',
          updatedAt: 'DESC' // Secondary sort by most recent activity
        },
        take: 10
      });

      this.logger.log(`${logPrefix} - Found ${leaderboard.length} entries for leaderboard`);

      // Get total participants count for metadata
      const totalParticipants = await this.userRewardsRepository.count({
        where: whereClause
      });

      // Build comprehensive leaderboard response
      const leaderboardData = await Promise.all(
        leaderboard.map(async (entry, index) => {
          // Calculate next level XP requirement
          const currentLevel = entry.level || 1;
          const nextLevelXP = this.getNextLevelXP(currentLevel);

          // Calculate level progress percentage
          const levelProgress = this.calculateLevelProgress(entry.totalXP, currentLevel);

          // Get recent achievements (last 5)
          const recentAchievements = entry.achievements
            ?.filter(achievement => achievement.createdAt)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5)
            .map(achievement => ({
              uid: achievement.uid,
              name: achievement.name,
              description: achievement.description,
              icon: achievement.icon,
              createdAt: achievement.createdAt
            })) || [];

          // Ensure xpBreakdown has all required fields
          const requiredFields = ['tasks', 'leads', 'sales', 'attendance', 'collaboration', 'login', 'other'];
          requiredFields.forEach(field => {
            if (!entry.xpBreakdown[field] && entry.xpBreakdown[field] !== 0) {
              entry.xpBreakdown[field] = 0;
            }
          });

          return {
            rank: index + 1,
            user: {
              uid: entry.owner.uid,
              username: entry.owner.username,
              name: entry.owner.name,
              surname: entry.owner.surname,
              photoURL: entry.owner.photoURL,
              branch: entry.owner.branch ? {
                uid: entry.owner.branch.uid,
                name: entry.owner.branch.name
              } : null
            },
            xp: {
              totalXP: entry.totalXP,
              currentXP: entry.currentXP,
              level: entry.level,
              rank: entry.rank,
              nextLevelXP: nextLevelXP,
              levelProgress: levelProgress,
              breakdown: entry.xpBreakdown
            },
            statistics: {
              xpThisMonth: await this.getXPThisMonth(entry.owner.uid),
              xpLastMonth: await this.getXPLastMonth(entry.owner.uid),
              rankChange: await this.getRankChange(entry.owner.uid, index + 1),
              consistencyStreak: await this.getConsistencyStreak(entry.owner.uid)
            },
            achievements: recentAchievements
          };
        })
      );

      const response = {
        message: process.env.SUCCESS_MESSAGE,
        data: {
          leaderboard: leaderboardData,
          metadata: {
            totalParticipants: totalParticipants,
            organizationId: orgId,
            branchId: branchId,
            generatedAt: new Date().toISOString(),
            period: 'all-time'
          }
        }
      };

      this.logger.log(`${logPrefix} - Successfully returning comprehensive leaderboard data`);
      return response;
    } catch (error) {
      this.logger.error(`${logPrefix} - Error occurred:`, error.message);
      this.logger.error(`${logPrefix} - Error stack:`, error.stack);

      const response = {
        message: error?.message,
        data: {
          leaderboard: [],
          metadata: {
            totalParticipants: 0,
            organizationId: orgId,
            branchId: branchId,
            generatedAt: new Date().toISOString(),
            period: 'all-time'
          }
        }
      };

      return response;
    }
  }

  private getNextLevelXP(currentLevel: number): number {
    // Find the next level's minimum XP requirement
    for (const [level, range] of Object.entries(LEVELS)) {
      const levelNum = parseInt(level);
      if (levelNum === currentLevel + 1) {
        return range.min;
      }
    }
    // If no next level found, return current level max + 1000
    const currentLevelRange = LEVELS[currentLevel.toString()];
    return currentLevelRange ? currentLevelRange.max + 1000 : 5000;
  }

  private calculateLevelProgress(totalXP: number, currentLevel: number): number {
    const currentLevelRange = LEVELS[currentLevel.toString()];
    if (!currentLevelRange) return 0;

    const levelMin = currentLevelRange.min;
    const levelMax = currentLevelRange.max;
    const xpInLevel = totalXP - levelMin;
    const levelRange = levelMax - levelMin;

    return levelRange > 0 ? Math.round((xpInLevel / levelRange) * 100 * 100) / 100 : 100;
  }

  private async getXPThisMonth(userId: number): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await this.xpTransactionRepository
      .createQueryBuilder('transaction')
      .select('SUM(transaction.xpAmount)', 'total')
      .where('transaction.userRewards.owner.uid = :userId', { userId })
      .andWhere('transaction.createdAt >= :startOfMonth', { startOfMonth })
      .getRawOne();

    return parseInt(result?.total || '0');
  }

  private async getXPLastMonth(userId: number): Promise<number> {
    const now = new Date();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const result = await this.xpTransactionRepository
      .createQueryBuilder('transaction')
      .select('SUM(transaction.xpAmount)', 'total')
      .where('transaction.userRewards.owner.uid = :userId', { userId })
      .andWhere('transaction.createdAt >= :startOfLastMonth', { startOfLastMonth })
      .andWhere('transaction.createdAt <= :endOfLastMonth', { endOfLastMonth })
      .getRawOne();

    return parseInt(result?.total || '0');
  }

  private async getRankChange(userId: number, currentRank: number): Promise<number> {
    // This would require storing historical rankings
    // For now, return a placeholder calculation
    // In a real implementation, you'd compare against last week's/month's ranking
    return 0; // No change
  }

  private async getConsistencyStreak(userId: number): Promise<number> {
    // Calculate consecutive days with XP activity
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyXP = await this.xpTransactionRepository
      .createQueryBuilder('transaction')
      .select('DATE(transaction.createdAt) as date')
      .addSelect('SUM(transaction.xpAmount) as daily_total')
      .where('transaction.userRewards.owner.uid = :userId', { userId })
      .andWhere('transaction.createdAt >= :thirtyDaysAgo', { thirtyDaysAgo })
      .groupBy('DATE(transaction.createdAt)')
      .orderBy('DATE(transaction.createdAt)', 'DESC')
      .getRawMany();

    // Calculate streak
    let streak = 0;
    const today = new Date().toDateString();

    for (const day of dailyXP) {
      const dayStr = new Date(day.date).toDateString();
      if (dayStr === today || streak > 0) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }
}
