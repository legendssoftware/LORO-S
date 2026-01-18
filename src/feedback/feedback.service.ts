import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Feedback } from './entities/feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { FeedbackStatus } from '../lib/enums/feedback.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client } from '../clients/entities/client.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Task } from '../tasks/entities/task.entity';
import { User } from '../user/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';

@Injectable()
export class FeedbackService {
  private readonly CACHE_TTL: number;
  private readonly CACHE_PREFIX = 'feedback:';

  constructor(
    @InjectRepository(Feedback)
    private feedbackRepository: Repository<Feedback>,
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
    @InjectRepository(Organisation)
    private organisationRepository: Repository<Organisation>,
    @InjectRepository(Branch)
    private branchRepository: Repository<Branch>,
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private readonly configService: ConfigService,
    @InjectRepository(OrganisationSettings)
    private organisationSettingsRepository: Repository<OrganisationSettings>,
  ) {
    this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
  }

  private getCacheKey(key: string | number): string {
    return `${this.CACHE_PREFIX}${key}`;
  }

  private async clearFeedbackCache(feedbackId?: number): Promise<void> {
    try {
      // Get all cache keys
      const keys = await this.cacheManager.store.keys();

      // Keys to clear
      const keysToDelete = [];

      // If specific feedback, clear its cache
      if (feedbackId) {
        keysToDelete.push(this.getCacheKey(feedbackId));
      }

      // Clear all pagination and filtered feedback list caches
      const feedbackListCaches = keys.filter(
        (key) =>
          key.startsWith('feedback_page') || // Pagination caches
          key.startsWith('feedback:all') || // All feedback cache
          key.includes('_limit'), // Filtered caches
      );
      keysToDelete.push(...feedbackListCaches);

      // Clear all caches
      await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
    } catch (error) {
      return error;
    }
  }

  async create(createFeedbackDto: CreateFeedbackDto): Promise<{ message: string; feedback: Feedback }> {
    try {
      // Create feedback entity
      const feedback = new Feedback();
      
      // Set basic properties
      feedback.type = createFeedbackDto.type;
      feedback.title = createFeedbackDto.title;
      feedback.comments = createFeedbackDto.comments;
      feedback.rating = createFeedbackDto.rating;
      feedback.attachments = createFeedbackDto.attachments || [];
      feedback.token = createFeedbackDto.token;
      feedback.status = FeedbackStatus.NEW;
      
      // Set relations if IDs are provided
      if (createFeedbackDto.clientId) {
        const client = await this.clientRepository.findOne({
          where: { uid: createFeedbackDto.clientId }
        });
        if (!client) {
          throw new NotFoundException(`Client with ID ${createFeedbackDto.clientId} not found`);
        }
        feedback.client = client;
      }
      
      if (createFeedbackDto.organisationId) {
        const organisation = await this.organisationRepository.findOne({
          where: { uid: createFeedbackDto.organisationId }
        });
        if (!organisation) {
          throw new NotFoundException(`Organisation with ID ${createFeedbackDto.organisationId} not found`);
        }
        feedback.organisation = organisation;
      }
      
      if (createFeedbackDto.branchId) {
        const branch = await this.branchRepository.findOne({
          where: { uid: createFeedbackDto.branchId }
        });
        if (!branch) {
          throw new NotFoundException(`Branch with ID ${createFeedbackDto.branchId} not found`);
        }
        feedback.branch = branch;
      }
      
      if (createFeedbackDto.taskId) {
        const task = await this.taskRepository.findOne({
          where: { uid: createFeedbackDto.taskId }
        });
        if (!task) {
          throw new NotFoundException(`Task with ID ${createFeedbackDto.taskId} not found`);
        }
        feedback.task = task;
      }
      
      // If token is provided, decode it to get client, task, etc.
      if (createFeedbackDto.token && !createFeedbackDto.clientId && !createFeedbackDto.taskId) {
        try {
          const decodedToken = Buffer.from(createFeedbackDto.token, 'base64').toString('utf8');
          const [clientId, taskId, timestamp] = decodedToken.split('-');
          
          if (clientId && !createFeedbackDto.clientId) {
            const client = await this.clientRepository.findOne({
              where: { uid: parseInt(clientId) },
              relations: ['organisation', 'branch']
            });
            if (client) {
              feedback.client = client;
              
              // If client has org/branch, set those too
              if (client.organisation && !createFeedbackDto.organisationId) {
                feedback.organisation = client.organisation;
              }
              
              if (client.branch && !createFeedbackDto.branchId) {
                feedback.branch = client.branch;
              }
            }
          }
          
          if (taskId && !createFeedbackDto.taskId) {
            const task = await this.taskRepository.findOne({
              where: { uid: parseInt(taskId) }
            });
            if (task) {
              feedback.task = task;
              // If task has org that hasn't been set by client, set it
              if (task.organisation && !feedback.organisation) {
                feedback.organisation = task.organisation;
              }
            }
          }
          
          // Validate token expiry
          if (timestamp) {
            const tokenDate = new Date(parseInt(timestamp));
            const now = new Date();
            const daysDifference = Math.floor((now.getTime() - tokenDate.getTime()) / (1000 * 60 * 60 * 24));
            
            // Get organization settings for token expiry if client has an organization
            let tokenExpiryDays = 30; // Default value
            
            if (feedback.client?.organisation?.uid) {
              try {
                const orgSettings = await this.organisationSettingsRepository.findOne({
                  where: { organisationUid: feedback.client.organisation.uid }
                });
                
                if (orgSettings?.feedbackTokenExpiryDays) {
                  tokenExpiryDays = orgSettings.feedbackTokenExpiryDays;
                }
              } catch (error) {
                // Silent fail - using default token expiry
              }
            }
            
            if (daysDifference > tokenExpiryDays) {
              throw new BadRequestException('Feedback token has expired. Please request a new feedback link.');
            }
          }
        } catch (error) {
          // If token decoding fails, just continue without it
        }
      }
      
      // Save the feedback
      const savedFeedback = await this.feedbackRepository.save(feedback);
      
      // Emit event
      this.eventEmitter.emit('feedback.created', savedFeedback);
      
      // Clear cache
      await this.clearFeedbackCache();
      
      return {
        message: process.env.SUCCESS_MESSAGE || 'Feedback submitted successfully',
        feedback: savedFeedback
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async findAll(
    filters?: {
      type?: string;
      status?: FeedbackStatus;
      startDate?: Date;
      endDate?: Date;
      clientId?: number;
      organisationId?: number;
      branchId?: number;
    },
    page: number = 1,
    limit: number = Number(process.env.DEFAULT_PAGE_LIMIT) || 10,
  ): Promise<PaginatedResponse<Feedback>> {
    try {
      // Calculate skip for pagination
      const skip = (page - 1) * limit;
      
      // Default where clause
      let whereClause: any = {
        isDeleted: false,
      };
      
      // Apply filters if provided
      if (filters) {
        if (filters.type) {
          whereClause.type = filters.type;
        }
        
        if (filters.status) {
          whereClause.status = filters.status;
        }
        
        if (filters.clientId) {
          whereClause.client = { uid: filters.clientId };
        }
        
        if (filters.organisationId) {
          whereClause.organisation = { uid: filters.organisationId };
        }
        
        if (filters.branchId) {
          whereClause.branch = { uid: filters.branchId };
        }
        
        if (filters.startDate && filters.endDate) {
          whereClause.createdAt = Between(filters.startDate, filters.endDate);
        }
      }
      
      // Get cached result if available
      const cacheKey = this.getCacheKey(`all_${JSON.stringify({ whereClause, page, limit })}`);
      const cachedResult = await this.cacheManager.get<PaginatedResponse<Feedback>>(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }
      
      // Query the database
      const [feedbacks, total] = await this.feedbackRepository.findAndCount({
        where: whereClause,
        relations: ['client', 'organisation', 'branch', 'task'],
        skip: skip,
        take: limit,
        order: {
          createdAt: 'DESC',
        },
      });
      
      // Prepare response
      const response = {
        data: feedbacks,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
        message: process.env.SUCCESS_MESSAGE || 'Feedback retrieved successfully',
      };
      
      // Cache the result
      await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);
      
      return response;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async findOne(id: number): Promise<{ message: string; feedback: Feedback }> {
    try {
      // Check cache first
      const cacheKey = this.getCacheKey(id);
      const cachedFeedback = await this.cacheManager.get<{ message: string; feedback: Feedback }>(cacheKey);
      
      if (cachedFeedback) {
        return cachedFeedback;
      }
      
      // Query database
      const feedback = await this.feedbackRepository.findOne({
        where: { uid: id, isDeleted: false },
        relations: ['client', 'organisation', 'branch', 'task'],
      });
      
      if (!feedback) {
        throw new NotFoundException(`Feedback with ID ${id} not found`);
      }
      
      const result = {
        message: process.env.SUCCESS_MESSAGE || 'Feedback retrieved successfully',
        feedback,
      };
      
      // Cache the result
      await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
      
      return result;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(id: number, updateFeedbackDto: UpdateFeedbackDto, userId?: number): Promise<{ message: string }> {
    try {
      // Find the feedback
      const feedback = await this.feedbackRepository.findOne({
        where: { uid: id, isDeleted: false }
      });
      
      if (!feedback) {
        throw new NotFoundException(`Feedback with ID ${id} not found`);
      }
      
      // Update fields
      if (updateFeedbackDto.type) feedback.type = updateFeedbackDto.type;
      if (updateFeedbackDto.title) feedback.title = updateFeedbackDto.title;
      if (updateFeedbackDto.comments) feedback.comments = updateFeedbackDto.comments;
      if (updateFeedbackDto.rating) feedback.rating = updateFeedbackDto.rating;
      if (updateFeedbackDto.attachments) feedback.attachments = updateFeedbackDto.attachments;
      if (updateFeedbackDto.status) feedback.status = updateFeedbackDto.status;
      
      // Update response if provided
      if (updateFeedbackDto.responseText) {
        feedback.responseText = updateFeedbackDto.responseText;
        feedback.respondedAt = new Date();
        feedback.respondedBy = updateFeedbackDto.respondedBy || userId;
        
        // If responding, update status to RESPONDED unless otherwise specified
        if (!updateFeedbackDto.status) {
          feedback.status = FeedbackStatus.RESPONDED;
        }
      }
      
      // Save the updated feedback
      await this.feedbackRepository.save(feedback);
      
      // Emit event
      this.eventEmitter.emit('feedback.updated', feedback);
      
      // Clear cache
      await this.clearFeedbackCache(id);
      
      return {
        message: process.env.SUCCESS_MESSAGE || 'Feedback updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: number): Promise<{ message: string }> {
    try {
      // Find the feedback
      const feedback = await this.feedbackRepository.findOne({
        where: { uid: id, isDeleted: false }
      });
      
      if (!feedback) {
        throw new NotFoundException(`Feedback with ID ${id} not found`);
      }
      
      // Soft delete
      feedback.isDeleted = true;
      await this.feedbackRepository.save(feedback);
      
      // Emit event
      this.eventEmitter.emit('feedback.deleted', feedback);
      
      // Clear cache
      await this.clearFeedbackCache(id);
      
      return {
        message: process.env.SUCCESS_MESSAGE || 'Feedback deleted successfully',
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async validateToken(token: string): Promise<{ 
    isValid: boolean; 
    clientId?: number;
    taskId?: number;
    organisationId?: number;
    branchId?: number;
  }> {
    try {
      // Decode the token
      const decodedToken = Buffer.from(token, 'base64').toString('utf8');
      const [clientId, taskId, timestamp] = decodedToken.split('-');
      
      // Get client with organization
      const client = await this.clientRepository.findOne({
        where: { uid: parseInt(clientId) },
        relations: ['organisation', 'branch']
      });
      
      if (!client) {
        return { isValid: false };
      }
      
      // Check if task exists
      const task = await this.taskRepository.findOne({
        where: { uid: parseInt(taskId) }
      });
      
      if (!task) {
        return { isValid: false };
      }
      
      // Get organization settings for token expiry
      const organisationId = client.organisation?.uid;
      let tokenExpiryDays = 30; // Default value
      
      if (organisationId) {
        try {
          const orgSettings = await this.organisationSettingsRepository.findOne({
            where: { organisationUid: organisationId }
          });
          
          if (orgSettings?.feedbackTokenExpiryDays) {
            tokenExpiryDays = orgSettings.feedbackTokenExpiryDays;
          }
        } catch (error) {
          console.error('Error fetching organization settings:', error);
        }
      }
      
      // Check if token is too old
      const tokenDate = new Date(parseInt(timestamp));
      const now = new Date();
      const daysDifference = Math.floor((now.getTime() - tokenDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDifference > tokenExpiryDays) {
        return { isValid: false };
      }
      
      // Return validation result with IDs
      return { 
        isValid: true,
        clientId: client.uid,
        taskId: task.uid,
        organisationId: client.organisation?.uid,
        branchId: client.branch?.uid
      };
    } catch (error) {
      return { isValid: false };
    }
  }

  async getFeedbackStats(
    organisationId: number,
    branchId?: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<any> {
    try {
      // Build where clause
      let whereClause: any = {
        isDeleted: false,
        organisation: { uid: organisationId }
      };
      
      if (branchId) {
        whereClause.branch = { uid: branchId };
      }
      
      if (startDate && endDate) {
        whereClause.createdAt = Between(startDate, endDate);
      }
      
      // Get cached result if available
      const cacheKey = this.getCacheKey(`stats_${JSON.stringify(whereClause)}`);
      const cachedStats = await this.cacheManager.get(cacheKey);
      
      if (cachedStats) {
        return cachedStats;
      }
      
      // Get all feedback that matches the criteria
      const feedbacks = await this.feedbackRepository.find({
        where: whereClause
      });
      
      // Calculate statistics
      const stats = {
        total: feedbacks.length,
        byType: this.groupByProperty(feedbacks, 'type'),
        byStatus: this.groupByProperty(feedbacks, 'status'),
        averageRating: this.calculateAverageRating(feedbacks),
        responseRate: this.calculateResponseRate(feedbacks),
        trendsOverTime: await this.calculateTrendsOverTime(whereClause)
      };
      
      // Cache the result
      await this.cacheManager.set(cacheKey, stats, this.CACHE_TTL);
      
      return stats;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  private groupByProperty(feedbacks: Feedback[], property: string): Record<string, number> {
    const result = {};
    
    feedbacks.forEach(feedback => {
      const value = feedback[property];
      result[value] = (result[value] || 0) + 1;
    });
    
    return result;
  }

  private calculateAverageRating(feedbacks: Feedback[]): number {
    const feedbacksWithRating = feedbacks.filter(f => f.rating !== null && f.rating !== undefined);
    
    if (feedbacksWithRating.length === 0) {
      return 0;
    }
    
    const sum = feedbacksWithRating.reduce((acc, feedback) => acc + feedback.rating, 0);
    return parseFloat((sum / feedbacksWithRating.length).toFixed(2));
  }

  private calculateResponseRate(feedbacks: Feedback[]): string {
    if (feedbacks.length === 0) {
      return '0%';
    }
    
    const respondedCount = feedbacks.filter(f => f.respondedAt !== null).length;
    const rate = (respondedCount / feedbacks.length) * 100;
    return `${rate.toFixed(2)}%`;
  }

  private async calculateTrendsOverTime(whereClause: any): Promise<any> {
    // Get feedback grouped by month
    // This is a simplified implementation - in a real system you might want to use SQL's date functions
    const feedbacks = await this.feedbackRepository.find({
      where: whereClause,
      select: ['createdAt', 'rating']
    });
    
    const byMonth = {};
    
    feedbacks.forEach(feedback => {
      const date = new Date(feedback.createdAt);
      const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
      
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = {
          count: 0,
          ratings: []
        };
      }
      
      byMonth[monthKey].count++;
      if (feedback.rating) {
        byMonth[monthKey].ratings.push(feedback.rating);
      }
    });
    
    // Calculate average rating per month
    const result = Object.entries(byMonth).map(([month, data]: [string, any]) => {
      const avgRating = data.ratings.length 
        ? data.ratings.reduce((sum, rating) => sum + rating, 0) / data.ratings.length
        : 0;
        
      return {
        month,
        count: data.count,
        averageRating: parseFloat(avgRating.toFixed(2))
      };
    });
    
    return result;
  }
} 