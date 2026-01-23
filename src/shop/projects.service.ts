import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Project } from './entities/project.entity';
import { Quotation } from './entities/quotation.entity';
import { Client } from '../clients/entities/client.entity';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignQuotationToProjectDto, UnassignQuotationFromProjectDto } from './dto/assign-quotation-to-project.dto';
import { ProjectStatus, ProjectPriority, ProjectType } from '../lib/enums/project.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { startOfDay, endOfDay } from 'date-fns';

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export interface ProjectFilters {
	status?: ProjectStatus;
	priority?: ProjectPriority;
	type?: ProjectType;
	clientId?: number;
	assignedUserId?: number;
	startDate?: Date;
	endDate?: Date;
	search?: string;
	orgId?: string;
	branchId?: number;
	budgetMin?: number;
	budgetMax?: number;
	progressMin?: number;
	progressMax?: number;
}

@Injectable()
export class ProjectsService {
	private readonly logger = new Logger(ProjectsService.name);
	private readonly CACHE_TTL = 300000; // 5 minutes

	constructor(
		@InjectRepository(Project)
		private readonly projectRepository: Repository<Project>,

		@InjectRepository(Quotation)
		private readonly quotationRepository: Repository<Quotation>,

		@InjectRepository(Client)
		private readonly clientRepository: Repository<Client>,

		@InjectRepository(User)
		private readonly userRepository: Repository<User>,

		@InjectRepository(Organisation)
		private readonly organisationRepository: Repository<Organisation>,

		@InjectRepository(Branch)
		private readonly branchRepository: Repository<Branch>,

		@Inject(CACHE_MANAGER)
		private readonly cacheManager: Cache,

		private readonly eventEmitter: EventEmitter2,
	) {}

	// Cache key generators
	private getProjectCacheKey(projectId: number): string {
		return `project:${projectId}`;
	}

	private getProjectListCacheKey(filters: ProjectFilters, page: number, limit: number): string {
		const filterString = JSON.stringify(filters);
		return `projects:list:${Buffer.from(filterString).toString('base64')}:${page}:${limit}`;
	}

	private getProjectStatsCacheKey(orgId?: string, branchId?: number): string {
		return `projects:stats:${orgId || 'all'}:${branchId || 'all'}`;
	}

	private getClientProjectsCacheKey(clientId: number): string {
		return `projects:client:${clientId}`;
	}

	private getUserProjectsCacheKey(userId: number): string {
		return `projects:user:${userId}`;
	}

	// Cache invalidation methods
	private async invalidateProjectCache(projectId?: number): Promise<void> {
		try {
			const keys = await this.cacheManager.store.keys();
			const keysToDelete = keys.filter((key: string) => {
				if (projectId && key === this.getProjectCacheKey(projectId)) return true;
				return key.startsWith('projects:list:') || 
					   key.startsWith('projects:stats:') || 
					   key.startsWith('projects:client:') || 
					   key.startsWith('projects:user:');
			});

			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
			this.logger.log(`Invalidated ${keysToDelete.length} project cache keys`);
		} catch (error) {
			this.logger.error('Failed to invalidate project cache', error.stack);
		}
	}

	/**
	 * Create a new project
	 */
	async createProject(
		createProjectDto: CreateProjectDto,
		orgId?: string,
		branchId?: number,
		createdById?: number,
	): Promise<{ message: string; project: Project }> {
		try {
			this.logger.log(`Creating new project: ${createProjectDto.name}`);

			// Validate client exists
			const client = await this.clientRepository.findOne({
				where: { uid: createProjectDto.client.uid },
			});

			if (!client) {
				throw new NotFoundException('Client not found');
			}

			// Validate assigned user exists
			const assignedUser = await this.userRepository.findOne({
				where: { uid: createProjectDto.assignedUser.uid },
			});

			if (!assignedUser) {
				throw new NotFoundException('Assigned user not found');
			}

			// Validate budget constraints
			if (createProjectDto.currentSpent && createProjectDto.currentSpent > createProjectDto.budget) {
				throw new BadRequestException('Current spent amount cannot exceed the budget');
			}

			// Lookup organisation by string (clerkOrgId or ref) for entity relation
			let organisation: Organisation | null = null;
			if (orgId) {
				organisation = await this.organisationRepository.findOne({
					where: [
						{ clerkOrgId: orgId },
						{ ref: orgId }
					]
				});
				if (!organisation) {
					throw new BadRequestException(`Organization not found for ID: ${orgId}`);
				}
			}

			// Create the project
			const project = this.projectRepository.create({
				...createProjectDto,
				client: { uid: createProjectDto.client.uid },
				assignedUser: { uid: createProjectDto.assignedUser.uid },
				...(organisation && { organisation }),
				...(branchId && { branch: { uid: branchId } }),
			});

			const savedProject = await this.projectRepository.save(project);

			// Fetch the complete project with relations
			const completeProject = await this.projectRepository.findOne({
				where: { uid: savedProject.uid },
				relations: ['client', 'assignedUser', 'organisation', 'branch', 'quotations'],
			});

			// Emit project creation event
			this.eventEmitter.emit('project.created', {
				projectId: completeProject.uid,
				projectName: completeProject.name,
				clientId: completeProject.client.uid,
				assignedUserId: completeProject.assignedUser.uid,
				budget: completeProject.budget,
				type: completeProject.type,
				priority: completeProject.priority,
				orgId,
				branchId,
				createdById,
				timestamp: new Date(),
			});

			// Invalidate cache
			await this.invalidateProjectCache();

			this.logger.log(`Project created successfully: ${completeProject.uid}`);

			return {
				message: 'Project created successfully',
				project: completeProject,
			};
		} catch (error) {
			this.logger.error('Failed to create project', error.stack);
			throw error;
		}
	}

	/**
	 * Get all projects with filtering and pagination
	 */
	async findAll(
		filters: ProjectFilters = {},
		page: number = 1,
		limit: number = 20,
		userRole?: AccessLevel,
		userId?: number,
	): Promise<PaginatedResponse<Project>> {
		try {
			const cacheKey = this.getProjectListCacheKey(filters, page, limit);
			const cached = await this.cacheManager.get<PaginatedResponse<Project>>(cacheKey);

			if (cached) {
				this.logger.log(`Cache hit for projects list: ${cacheKey}`);
				return cached;
			}

			const skip = (page - 1) * limit;

			// Build the query
			const queryBuilder = this.projectRepository
				.createQueryBuilder('project')
				.leftJoinAndSelect('project.client', 'client')
				.leftJoinAndSelect('project.assignedUser', 'assignedUser')
				.leftJoinAndSelect('project.organisation', 'organisation')
				.leftJoinAndSelect('project.branch', 'branch')
				.leftJoinAndSelect('project.quotations', 'quotations');

			// Apply filters
			if (filters.status) {
				queryBuilder.andWhere('project.status = :status', { status: filters.status });
			}

			if (filters.priority) {
				queryBuilder.andWhere('project.priority = :priority', { priority: filters.priority });
			}

			if (filters.type) {
				queryBuilder.andWhere('project.type = :type', { type: filters.type });
			}

			if (filters.clientId) {
				queryBuilder.andWhere('client.uid = :clientId', { clientId: filters.clientId });
			}

			if (filters.assignedUserId) {
				queryBuilder.andWhere('assignedUser.uid = :assignedUserId', { assignedUserId: filters.assignedUserId });
			}

			if (filters.startDate && filters.endDate) {
				queryBuilder.andWhere('project.startDate BETWEEN :startDate AND :endDate', {
					startDate: startOfDay(filters.startDate),
					endDate: endOfDay(filters.endDate),
				});
			}

			if (filters.budgetMin !== undefined) {
				queryBuilder.andWhere('project.budget >= :budgetMin', { budgetMin: filters.budgetMin });
			}

			if (filters.budgetMax !== undefined) {
				queryBuilder.andWhere('project.budget <= :budgetMax', { budgetMax: filters.budgetMax });
			}

			if (filters.progressMin !== undefined) {
				queryBuilder.andWhere('project.progressPercentage >= :progressMin', { progressMin: filters.progressMin });
			}

			if (filters.progressMax !== undefined) {
				queryBuilder.andWhere('project.progressPercentage <= :progressMax', { progressMax: filters.progressMax });
			}

			if (filters.search) {
				queryBuilder.andWhere(
					'(project.name LIKE :search OR project.description LIKE :search OR client.name LIKE :search OR assignedUser.name LIKE :search)',
					{ search: `%${filters.search}%` },
				);
			}

			// Add org and branch filters
			if (filters.orgId) {
				queryBuilder.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId: filters.orgId });
			}

			if (filters.branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId: filters.branchId });
			}

			// Role-based filtering: non-privileged users can only see their assigned projects
			const privilegedRoles = [AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER, AccessLevel.MANAGER];
			const isPrivilegedUser = privilegedRoles.includes(userRole);
			
			if (!isPrivilegedUser && userId) {
				queryBuilder.andWhere('assignedUser.uid = :userId', { userId });
			}

			// Add soft delete filter
			queryBuilder.andWhere('project.isDeleted = :isDeleted', { isDeleted: false });

			// Count total records
			const total = await queryBuilder.getCount();
			const totalPages = Math.ceil(total / limit);

			// Get paginated results
			const data = await queryBuilder
				.orderBy('project.createdAt', 'DESC')
				.skip(skip)
				.take(limit)
				.getMany();

			const result = {
				data,
				total,
				page,
				limit,
				totalPages,
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			this.logger.log(`Projects retrieved: ${data.length} of ${total} total`);

			return result;
		} catch (error) {
			this.logger.error('Failed to fetch projects', error.stack);
			throw error;
		}
	}

	/**
	 * Get a single project by ID
	 */
	async findOne(
		projectId: number,
		orgId?: string,
		branchId?: number,
	): Promise<{ message: string; project: Project }> {
		try {
			const cacheKey = this.getProjectCacheKey(projectId);
			const cached = await this.cacheManager.get<Project>(cacheKey);

			if (cached) {
				this.logger.log(`Cache hit for project: ${projectId}`);
				return { message: 'Project retrieved successfully', project: cached };
			}

			const queryBuilder = this.projectRepository
				.createQueryBuilder('project')
				.leftJoinAndSelect('project.client', 'client')
				.leftJoinAndSelect('project.assignedUser', 'assignedUser')
				.leftJoinAndSelect('project.organisation', 'organisation')
				.leftJoinAndSelect('project.branch', 'branch')
				.leftJoinAndSelect('project.quotations', 'quotations')
				.leftJoinAndSelect('quotations.quotationItems', 'quotationItems')
				.leftJoinAndSelect('quotationItems.product', 'product')
				.where('project.uid = :projectId', { projectId })
				.andWhere('project.isDeleted = :isDeleted', { isDeleted: false });

			// Add org and branch filters if provided
			if (orgId) {
				queryBuilder.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const project = await queryBuilder.getOne();

			if (!project) {
				throw new NotFoundException('Project not found');
			}

			// Cache the result
			await this.cacheManager.set(cacheKey, project, this.CACHE_TTL);

			this.logger.log(`Project retrieved successfully: ${projectId}`);

			return {
				message: 'Project retrieved successfully',
				project,
			};
		} catch (error) {
			this.logger.error(`Failed to fetch project ${projectId}`, error.stack);
			throw error;
		}
	}

	/**
	 * Update a project
	 */
	async updateProject(
		projectId: number,
		updateProjectDto: UpdateProjectDto,
		orgId?: string,
		branchId?: number,
		updatedById?: number,
	): Promise<{ message: string; project: Project }> {
		try {
			this.logger.log(`Updating project: ${projectId}`);

			// Find the existing project
			const { project: existingProject } = await this.findOne(projectId, orgId, branchId);

			// Validate client if being updated
			if (updateProjectDto.client?.uid) {
				const client = await this.clientRepository.findOne({
					where: { uid: updateProjectDto.client.uid },
				});

				if (!client) {
					throw new NotFoundException('Client not found');
				}
			}

			// Validate assigned user if being updated
			if (updateProjectDto.assignedUser?.uid) {
				const assignedUser = await this.userRepository.findOne({
					where: { uid: updateProjectDto.assignedUser.uid },
				});

				if (!assignedUser) {
					throw new NotFoundException('Assigned user not found');
				}
			}

			// Validate budget constraints
			const newBudget = updateProjectDto.budget ?? existingProject.budget;
			const newCurrentSpent = updateProjectDto.currentSpent ?? existingProject.currentSpent;

			if (newCurrentSpent > newBudget) {
				throw new BadRequestException('Current spent amount cannot exceed the budget');
			}

			// Prepare update data
			const updateData = {
				...updateProjectDto,
				...(updateProjectDto.client?.uid && { client: { uid: updateProjectDto.client.uid } }),
				...(updateProjectDto.assignedUser?.uid && { assignedUser: { uid: updateProjectDto.assignedUser.uid } }),
			};

			// Update the project
			await this.projectRepository.update(projectId, updateData);

			// Fetch the updated project
			const { project: updatedProject } = await this.findOne(projectId, orgId, branchId);

			// Emit project update event
			this.eventEmitter.emit('project.updated', {
				projectId: updatedProject.uid,
				projectName: updatedProject.name,
				changes: updateProjectDto,
				previousStatus: existingProject.status,
				newStatus: updatedProject.status,
				updatedById,
				timestamp: new Date(),
			});

			// Invalidate cache
			await this.invalidateProjectCache(projectId);

			this.logger.log(`Project updated successfully: ${projectId}`);

			return {
				message: 'Project updated successfully',
				project: updatedProject,
			};
		} catch (error) {
			this.logger.error(`Failed to update project ${projectId}`, error.stack);
			throw error;
		}
	}

	/**
	 * Delete a project (soft delete)
	 */
	async deleteProject(
		projectId: number,
		orgId?: string,
		branchId?: number,
		deletedById?: number,
	): Promise<{ message: string }> {
		try {
			this.logger.log(`Deleting project: ${projectId}`);

			// Find the project first
			const { project } = await this.findOne(projectId, orgId, branchId);

			// Check if project has active quotations
			const activeQuotations = project.quotations?.filter(q => !['cancelled', 'rejected'].includes(q.status.toLowerCase()));
			if (activeQuotations?.length > 0) {
				throw new BadRequestException('Cannot delete project with active quotations. Please cancel or complete all quotations first.');
			}

			// Soft delete the project
			await this.projectRepository.update(projectId, { isDeleted: true });

			// Emit project deletion event
			this.eventEmitter.emit('project.deleted', {
				projectId: project.uid,
				projectName: project.name,
				clientId: project.client.uid,
				deletedById,
				timestamp: new Date(),
			});

			// Invalidate cache
			await this.invalidateProjectCache(projectId);

			this.logger.log(`Project deleted successfully: ${projectId}`);

			return { message: 'Project deleted successfully' };
		} catch (error) {
			this.logger.error(`Failed to delete project ${projectId}`, error.stack);
			throw error;
		}
	}

	/**
	 * Assign quotations to a project
	 */
	async assignQuotationsToProject(
		assignDto: AssignQuotationToProjectDto,
		orgId?: string,
		branchId?: number,
		assignedById?: number,
	): Promise<{ message: string; assignedCount: number; project: Project }> {
		try {
			this.logger.log(`Assigning ${assignDto.quotationIds.length} quotations to project ${assignDto.projectId}`);

			// Find the project
			const { project } = await this.findOne(assignDto.projectId, orgId, branchId);

			// Find the quotations
			// Filter by clerkOrgId or ref (both are strings)
			const quotationWhere: any = { 
				uid: In(assignDto.quotationIds),
			};
			if (orgId) {
				quotationWhere.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}
			if (branchId) {
				quotationWhere.branch = { uid: branchId };
			}
			const quotations = await this.quotationRepository.find({
				where: quotationWhere,
				relations: ['client', 'project'],
			});

			if (quotations.length !== assignDto.quotationIds.length) {
				const foundIds = quotations.map(q => q.uid);
				const missingIds = assignDto.quotationIds.filter(id => !foundIds.includes(id));
				throw new NotFoundException(`Quotations not found: ${missingIds.join(', ')}`);
			}

			// Validate that quotations belong to the same client as the project
			const invalidQuotations = quotations.filter(q => q.client.uid !== project.client.uid);
			if (invalidQuotations.length > 0) {
				const invalidIds = invalidQuotations.map(q => q.uid);
				throw new BadRequestException(`Quotations ${invalidIds.join(', ')} do not belong to the same client as the project`);
			}

			// Check for already assigned quotations
			const alreadyAssigned = quotations.filter(q => q.project?.uid && q.project.uid !== assignDto.projectId);
			if (alreadyAssigned.length > 0) {
				const assignedIds = alreadyAssigned.map(q => `${q.uid} (assigned to project ${q.project.uid})`);
				throw new BadRequestException(`Quotations already assigned to other projects: ${assignedIds.join(', ')}`);
			}

			// Assign quotations to the project
			await this.quotationRepository.update(
				{ uid: In(assignDto.quotationIds) },
				{ project: { uid: assignDto.projectId } }
			);

			// Fetch updated project
			const { project: updatedProject } = await this.findOne(assignDto.projectId, orgId, branchId);

			// Calculate total quotation value
			const totalQuotationValue = quotations.reduce((sum, q) => sum + Number(q.totalAmount), 0);

			// Emit quotation assignment event
			this.eventEmitter.emit('quotations.assigned', {
				projectId: assignDto.projectId,
				quotationIds: assignDto.quotationIds,
				totalValue: totalQuotationValue,
				assignedById,
				notes: assignDto.notes,
				timestamp: new Date(),
			});

			// Invalidate cache
			await this.invalidateProjectCache(assignDto.projectId);

			this.logger.log(`Successfully assigned ${quotations.length} quotations to project ${assignDto.projectId}`);

			return {
				message: 'Quotations assigned to project successfully',
				assignedCount: quotations.length,
				project: updatedProject,
			};
		} catch (error) {
			this.logger.error('Failed to assign quotations to project', error.stack);
			throw error;
		}
	}

	/**
	 * Unassign quotations from their current project
	 */
	async unassignQuotationsFromProject(
		unassignDto: UnassignQuotationFromProjectDto,
		orgId?: string,
		branchId?: number,
		unassignedById?: number,
	): Promise<{ message: string; unassignedCount: number }> {
		try {
			this.logger.log(`Unassigning ${unassignDto.quotationIds.length} quotations from their projects`);

			// Find the quotations
			// Filter by clerkOrgId or ref (both are strings)
			const quotationWhere: any = { 
				uid: In(unassignDto.quotationIds),
			};
			if (orgId) {
				quotationWhere.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}
			if (branchId) {
				quotationWhere.branch = { uid: branchId };
			}
			const quotations = await this.quotationRepository.find({
				where: quotationWhere,
				relations: ['project'],
			});

			if (quotations.length !== unassignDto.quotationIds.length) {
				const foundIds = quotations.map(q => q.uid);
				const missingIds = unassignDto.quotationIds.filter(id => !foundIds.includes(id));
				throw new NotFoundException(`Quotations not found: ${missingIds.join(', ')}`);
			}

			// Track which projects will be affected
			const affectedProjectIds = [...new Set(quotations.filter(q => q.project).map(q => q.project.uid))];

			// Unassign quotations from their projects
			await this.quotationRepository.update(
				{ uid: In(unassignDto.quotationIds) },
				{ project: null }
			);

			// Emit quotation unassignment event
			this.eventEmitter.emit('quotations.unassigned', {
				quotationIds: unassignDto.quotationIds,
				affectedProjectIds,
				unassignedById,
				reason: unassignDto.reason,
				timestamp: new Date(),
			});

			// Invalidate cache for affected projects
			await Promise.all(affectedProjectIds.map(id => this.invalidateProjectCache(id)));

			this.logger.log(`Successfully unassigned ${quotations.length} quotations from their projects`);

			return {
				message: 'Quotations unassigned from projects successfully',
				unassignedCount: quotations.length,
			};
		} catch (error) {
			this.logger.error('Failed to unassign quotations from projects', error.stack);
			throw error;
		}
	}

	/**
	 * Get projects by client
	 */
	async getProjectsByClient(
		clientId: number,
		orgId?: string,
		branchId?: number,
	): Promise<{ message: string; projects: Project[] }> {
		try {
			const cacheKey = this.getClientProjectsCacheKey(clientId);
			const cached = await this.cacheManager.get<Project[]>(cacheKey);

			if (cached) {
				this.logger.log(`Cache hit for client projects: ${clientId}`);
				return { message: 'Client projects retrieved successfully', projects: cached };
			}

			const queryBuilder = this.projectRepository
				.createQueryBuilder('project')
				.leftJoinAndSelect('project.client', 'client')
				.leftJoinAndSelect('project.assignedUser', 'assignedUser')
				.leftJoinAndSelect('project.quotations', 'quotations')
				.where('client.uid = :clientId', { clientId })
				.andWhere('project.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				queryBuilder
					.leftJoinAndSelect('project.organisation', 'organisation')
					.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			if (branchId) {
				queryBuilder
					.leftJoinAndSelect('project.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			const projects = await queryBuilder
				.orderBy('project.createdAt', 'DESC')
				.getMany();

			// Cache the result
			await this.cacheManager.set(cacheKey, projects, this.CACHE_TTL);

			this.logger.log(`Retrieved ${projects.length} projects for client ${clientId}`);

			return {
				message: 'Client projects retrieved successfully',
				projects,
			};
		} catch (error) {
			this.logger.error(`Failed to fetch projects for client ${clientId}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get projects by assigned user
	 */
	async getProjectsByUser(
		userId: number,
		orgId?: string,
		branchId?: number,
	): Promise<{ message: string; projects: Project[] }> {
		try {
			const cacheKey = this.getUserProjectsCacheKey(userId);
			const cached = await this.cacheManager.get<Project[]>(cacheKey);

			if (cached) {
				this.logger.log(`Cache hit for user projects: ${userId}`);
				return { message: 'User projects retrieved successfully', projects: cached };
			}

			const queryBuilder = this.projectRepository
				.createQueryBuilder('project')
				.leftJoinAndSelect('project.client', 'client')
				.leftJoinAndSelect('project.assignedUser', 'assignedUser')
				.leftJoinAndSelect('project.quotations', 'quotations')
				.where('assignedUser.uid = :userId', { userId })
				.andWhere('project.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				queryBuilder
					.leftJoinAndSelect('project.organisation', 'organisation')
					.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			if (branchId) {
				queryBuilder
					.leftJoinAndSelect('project.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			const projects = await queryBuilder
				.orderBy('project.createdAt', 'DESC')
				.getMany();

			// Cache the result
			await this.cacheManager.set(cacheKey, projects, this.CACHE_TTL);

			this.logger.log(`Retrieved ${projects.length} projects for user ${userId}`);

			return {
				message: 'User projects retrieved successfully',
				projects,
			};
		} catch (error) {
			this.logger.error(`Failed to fetch projects for user ${userId}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get project statistics
	 */
	async getProjectStats(
		orgId?: string,
		branchId?: number,
	): Promise<{
		message: string;
		stats: {
			totalProjects: number;
			projectsByStatus: Record<ProjectStatus, number>;
			projectsByPriority: Record<ProjectPriority, number>;
			projectsByType: Record<ProjectType, number>;
			totalBudget: number;
			totalSpent: number;
			averageBudget: number;
			averageProgress: number;
			upcomingDeadlines: Project[];
			overdueProjects: Project[];
		};
	}> {
		try {
			const cacheKey = this.getProjectStatsCacheKey(orgId, branchId);
			const cached = await this.cacheManager.get(cacheKey);

			if (cached) {
				this.logger.log(`Cache hit for project stats: ${cacheKey}`);
				return cached;
			}

			const queryBuilder = this.projectRepository
				.createQueryBuilder('project')
				.leftJoinAndSelect('project.client', 'client')
				.leftJoinAndSelect('project.assignedUser', 'assignedUser')
				.where('project.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				queryBuilder
					.leftJoinAndSelect('project.organisation', 'organisation')
					.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			if (branchId) {
				queryBuilder
					.leftJoinAndSelect('project.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			const projects = await queryBuilder.getMany();

			// Calculate statistics
			const totalProjects = projects.length;
			const totalBudget = projects.reduce((sum, p) => sum + Number(p.budget), 0);
			const totalSpent = projects.reduce((sum, p) => sum + Number(p.currentSpent), 0);
			const averageBudget = totalProjects > 0 ? totalBudget / totalProjects : 0;
			const averageProgress = totalProjects > 0 ? 
				projects.reduce((sum, p) => sum + Number(p.progressPercentage), 0) / totalProjects : 0;

			// Group by status
			const projectsByStatus = projects.reduce((acc, project) => {
				acc[project.status] = (acc[project.status] || 0) + 1;
				return acc;
			}, {} as Record<ProjectStatus, number>);

			// Group by priority
			const projectsByPriority = projects.reduce((acc, project) => {
				acc[project.priority] = (acc[project.priority] || 0) + 1;
				return acc;
			}, {} as Record<ProjectPriority, number>);

			// Group by type
			const projectsByType = projects.reduce((acc, project) => {
				acc[project.type] = (acc[project.type] || 0) + 1;
				return acc;
			}, {} as Record<ProjectType, number>);

			// Find upcoming deadlines (next 30 days)
			const thirtyDaysFromNow = new Date();
			thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

			const upcomingDeadlines = projects.filter(p => 
				p.endDate && 
				p.endDate > new Date() && 
				p.endDate <= thirtyDaysFromNow &&
				!['completed', 'cancelled'].includes(p.status.toLowerCase())
			).sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

			// Find overdue projects
			const now = new Date();
			const overdueProjects = projects.filter(p => 
				p.endDate && 
				p.endDate < now &&
				!['completed', 'cancelled'].includes(p.status.toLowerCase())
			).sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

			const stats = {
				totalProjects,
				projectsByStatus,
				projectsByPriority,
				projectsByType,
				totalBudget,
				totalSpent,
				averageBudget,
				averageProgress,
				upcomingDeadlines: upcomingDeadlines.slice(0, 10), // Top 10
				overdueProjects: overdueProjects.slice(0, 10), // Top 10
			};

			const result = {
				message: 'Project statistics retrieved successfully',
				stats,
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			this.logger.log(`Project statistics calculated for ${totalProjects} projects`);

			return result;
		} catch (error) {
			this.logger.error('Failed to calculate project statistics', error.stack);
			throw error;
		}
	}
} 