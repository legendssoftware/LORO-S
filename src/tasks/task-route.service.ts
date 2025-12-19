import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { startOfDay as dateFnsStartOfDay, endOfDay as dateFnsEndOfDay } from 'date-fns';
import { Task } from './entities/task.entity';
import { Client } from '../clients/entities/client.entity';
import { User } from '../user/entities/user.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GoogleMapsService } from '../lib/services/google-maps.service';
import { Route } from './entities/route.entity';
import { OnEvent } from '@nestjs/event-emitter';
import { Location } from './interfaces/route.interface';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { OrganizationHoursService } from '../attendance/services/organization.hours.service';
import { toZonedTime } from 'date-fns-tz';

@Injectable()
export class TaskRouteService {
	private readonly CACHE_TTL = 3600; // 1 hour in seconds
	private readonly BRANCH_CACHE_PREFIX = 'branch';

	constructor(
		@InjectRepository(Task)
		private readonly taskRepository: Repository<Task>,
		@InjectRepository(Client)
		private readonly clientRepository: Repository<Client>,
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		@InjectRepository(Branch)
		private readonly branchRepository: Repository<Branch>,
		@InjectRepository(Organisation)
		private readonly organisationRepository: Repository<Organisation>,
		@InjectRepository(Route)
		private readonly routeRepository: Repository<Route>,
		private readonly googleMapsService: GoogleMapsService,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		private readonly organizationHoursService: OrganizationHoursService,
	) {}

	private getBranchCacheKey(branchUid: number): string {
		return `${this.BRANCH_CACHE_PREFIX}:uid:${branchUid}`;
	}

	private async getCachedBranch(branchUid: number): Promise<Branch | null> {
		return this.cacheManager.get<Branch>(this.getBranchCacheKey(branchUid));
	}

	private async cacheBranch(branch: Branch): Promise<void> {
		await this.cacheManager.set(this.getBranchCacheKey(branch.uid), branch, this.CACHE_TTL);
	}

	private getCacheKey(taskId: number, date: Date): string {
		return `route_${taskId}_${date.toISOString().split('T')[0]}`;
	}

	async getRouteFromCache(taskId: number, date: Date): Promise<Route | null> {
		const cacheKey = this.getCacheKey(taskId, date);
		return this.cacheManager.get(cacheKey);
	}

	async saveRouteToCache(taskId: number, date: Date, route: Route): Promise<void> {
		const cacheKey = this.getCacheKey(taskId, date);
		await this.cacheManager.set(cacheKey, route, this.CACHE_TTL);
	}

	async invalidateRouteCache(taskId: number, date: Date): Promise<void> {
		const cacheKey = this.getCacheKey(taskId, date);
		await this.cacheManager.del(cacheKey);
	}

	@OnEvent('task.created')
	async handleTaskCreated(payload: { task: Task }) {
		await this.planRouteForTask(payload?.task);
	}

	@OnEvent('task.updated')
	async handleTaskUpdated(payload: { task: Task }) {
		// Delete existing routes for this task
		await this.routeRepository.delete({ task: { uid: payload?.task?.uid } });
		// Replan routes
		await this.planRouteForTask(payload?.task);
	}

	@OnEvent('task.assigneeChanged')
	async handleAssigneeChanged(payload: { task: Task }) {
		await this.handleTaskUpdated(payload);
	}

	@OnEvent('task.clientChanged')
	async handleClientChanged(payload: { task: Task }) {
		await this.handleTaskUpdated(payload);
	}

	@OnEvent('task.deadlineChanged')
	async handleDeadlineChanged(payload: { task: Task }) {
		await this.handleTaskUpdated(payload);
	}

	private async planRouteForTask(task: Task, retryCount = 0) {
		const MAX_RETRIES = 3;
		const assignees = task.assignees || [];
		const clients = task.clients || [];

		if (assignees.length === 0 || clients.length === 0) {
			return;
		}

		for (const assignee of assignees) {
			try {
				const user = await this.userRepository.findOne({
					where: { uid: assignee?.uid },
					relations: ['branch'],
				});

				if (!user?.branch) {
					//if the user has no branch email the org to complete the user detail setup
					continue;
				}

				// Try to get branch from cache first
				let branch = await this.getCachedBranch(user.branch.uid);

				// If not in cache, fetch from database
				if (!branch) {
					branch = await this.branchRepository.findOne({
						where: { uid: user?.branch?.uid },
					});

					// Store in cache if found
					if (branch) {
						await this.cacheBranch(branch);
					}
				}

				if (!branch) {
					continue;
				}

				const clientLocations = await this.getClientLocations([task]);
				const destinations = Array.from(clientLocations.values()).map((loc) => ({
					lat: loc?.latitude,
					lng: loc?.longitude,
				}));

				if (destinations?.length === 0) {
					continue;
				}

				// Convert the branch address to a properly formatted string for geocoding
				const branchAddress = branch?.address
					? `${branch.address?.street}, ${branch.address?.city}, ${branch.address?.state}, ${branch.address?.country}, ${branch.address?.postalCode}`
					: '';

				// Geocode the branch address to get lat/lng coordinates
				const geocodeResult = await this.googleMapsService.geocodeAddress(branchAddress);
				const origin = {
					lat: geocodeResult.address.latitude,
					lng: geocodeResult.address.longitude,
				};

				try {
					const optimizedRoute = await this.googleMapsService.optimizeRouteLatLng(origin, destinations);

					const waypoints = clients.map((client) => {
						const location = clientLocations.get(client.uid);
						return {
							taskId: task?.uid,
							clientId: client?.uid,
							location: {
								lat: location?.latitude,
								lng: location?.longitude,
							},
						};
					});

					const route = this.routeRepository.create({
						task,
						assignee: user,
						branch: branch,
						waypoints,
						waypointOrder: optimizedRoute?.waypointOrder,
						legs: optimizedRoute?.legs,
						totalDistance: optimizedRoute?.totalDistance,
						totalDuration: optimizedRoute?.totalDuration,
						plannedDate: task?.deadline,
						isOptimized: true,
					});

					await this.routeRepository.save(route);
				} catch (error) {
					if (retryCount < MAX_RETRIES) {
						await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
						return this.planRouteForTask(task, retryCount + 1);
					}
					throw error;
				}
			} catch (error) {
				if (retryCount < MAX_RETRIES) {
					await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
					return this.planRouteForTask(task, retryCount + 1);
				}
				throw error;
			}
		}
	}

	/**
	 * Get client locations for tasks
	 */
	private async getClientLocations(tasks: Task[]): Promise<Map<number, Location>> {
		const clientIds = new Set<number>();
		tasks.forEach((task) => {
			task.clients?.forEach((client) => clientIds.add(client.uid));
		});

		const clients = await this.clientRepository.find({
			where: {
				uid: In(Array.from(clientIds)),
			},
		});

		const clientLocations = new Map<number, Location>();

		// Use Promise.all to handle all geocoding requests in parallel
		await Promise.all(
			clients.map(async (client) => {
				const address = client.address;
				if (address) {
					const formattedAddress = `${address.street}, ${address.city}, ${address.state}, ${address.country}, ${address.postalCode}`;
					try {
						const geocodeResult = await this.googleMapsService.geocodeAddress(formattedAddress);
						clientLocations.set(client.uid, {
							latitude: geocodeResult.address.latitude,
							longitude: geocodeResult.address.longitude,
							address: formattedAddress,
						});
					} catch (error) {
						console.error(`Failed to geocode address for client ${client.uid}:`, error);
					}
				}
			}),
		);

		return clientLocations;
	}

	/**
	 * Get routes for all tasks on a given date without recalculating
	 */
	async getRoutes(date: Date = new Date(), organisationRef?: string, branchId?: number): Promise<Route[]> {
		const startOfDay = new Date(date);
		startOfDay.setHours(0, 0, 0, 0);

		const endOfDay = new Date(date);
		endOfDay.setHours(23, 59, 59, 999);

		// Build the where clause
		const where: any = {
			plannedDate: Between(startOfDay, endOfDay),
			isDeleted: false,
		};

		// Add organization and branch filters if provided
		if (organisationRef) {
			where.organisation = { ref: organisationRef };
		}

		if (branchId) {
			where.branch = { uid: branchId };
		}

		// First try to get routes from the database
		const routes = await this.routeRepository.find({
			where,
			relations: ['assignee', 'branch', 'task'],
		});

		return routes;
	}

	/**
	 * Plan routes for all tasks on a given date - timezone-aware
	 */
	@Cron(CronExpression.EVERY_DAY_AT_5AM)
	async planRoutes(date: Date = new Date(), organisationRef?: string, branchId?: number): Promise<Route[]> {
		// If organization is provided, use its timezone; otherwise use default
		let organizationTimezone = 'Africa/Johannesburg';
		let orgId: number | undefined;
		
		if (organisationRef) {
			const org = await this.organisationRepository.findOne({
				where: { ref: organisationRef },
			});
			if (org) {
				orgId = org.uid;
				const organizationHours = await this.organizationHoursService.getOrganizationHours(org.uid);
				organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';
			}
		}

		// Calculate start and end of day in organization timezone
		const dayStart = dateFnsStartOfDay(date);
		const dayEnd = dateFnsEndOfDay(date);
		const startOfDay = toZonedTime(dayStart, organizationTimezone);
		const endOfDay = toZonedTime(dayEnd, organizationTimezone);

		// Build the where clause
		const where: any = {
			deadline: Between(startOfDay, endOfDay),
			isDeleted: false,
		};

		// Add organization and branch filters if provided
		if (organisationRef) {
			where.organisation = { ref: organisationRef };
		}

		if (branchId) {
			where.branch = { uid: branchId };
		}

		const tasks = await this.taskRepository.find({
			where,
			relations: ['assignees', 'clients', 'branch'],
		});

		const routes: Route[] = [];
		for (const task of tasks) {
			// Check cache first
			const cachedRoute = await this.getRouteFromCache(task?.uid, date);

			if (cachedRoute) {
				routes.push(cachedRoute);
				continue;
			}

			// If not in cache, plan new route
			try {
				await this.planRouteForTask(task);
				const newRoute = await this.routeRepository.findOne({
					where: { task: { uid: task.uid } },
					order: { createdAt: 'DESC' },
				});
				if (newRoute) {
					await this.saveRouteToCache(task.uid, date, newRoute);
					routes.push(newRoute);
				}
			} catch (error) {
				console.error(`Failed to plan route for task ${task.uid}:`, error);
			}
		}

		return routes;
	}
}
