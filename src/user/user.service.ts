/**
 * UserService - Comprehensive User Management Service
 *
 * This service handles all user-related operations including:
 * - User CRUD operations with organization and branch scoping
 * - Authentication and authorization management
 * - User target setting and progress tracking
 * - Email verification and password reset workflows
 * - User invitation and re-invitation functionality
 * - Advanced caching and performance optimization
 * - User metrics and analytics calculation
 *
 * Features:
 * - Multi-tenant support with organization and branch isolation
 * - Redis caching for improved performance
 * - Event-driven architecture for real-time updates
 * - Comprehensive logging and error handling
 * - Role-based access control (RBAC) integration
 * - Bulk operations support
 * - Email notification integration
 *
 * @author Loro Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

import * as bcrypt from 'bcrypt';
import { In, Repository, LessThanOrEqual, Not, QueryFailedError } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { format, addDays, addMonths, startOfMonth } from 'date-fns';
import { User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserPreferencesDto } from './dto/create-user-preferences.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { BadRequestException, Injectable, NotFoundException, Inject, Logger, ConflictException } from '@nestjs/common';
import { NewSignUp } from '../lib/types/user';
import { AccountStatus } from '../lib/enums/status.enums';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { AccessLevel } from '../lib/enums/user.enums';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { CreateUserTargetDto } from './dto/create-user-target.dto';
import { UpdateUserTargetDto } from './dto/update-user-target.dto';
import { UserTarget } from './entities/user-target.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { Order } from '../shop/entities/order.entity';
import { OrderStatus } from '../lib/enums/status.enums';
import { Lead } from '../leads/entities/lead.entity';
import { Client } from '../clients/entities/client.entity';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { Between } from 'typeorm';
import { EmailType } from '../lib/enums/email.enums';
import { NewUserWelcomeData } from '../lib/types/email-templates.types';
import { ExternalTargetUpdateDto, TargetUpdateMode } from './dto/external-target-update.dto';
import { formatDateSafely } from '../lib/utils/date.utils';
import { formatInTimeZone } from 'date-fns-tz';
import { BulkCreateUserDto, BulkCreateUserResponse, BulkUserResult } from './dto/bulk-create-user.dto';
import { BulkUpdateUserDto, BulkUpdateUserResponse, BulkUpdateUserResult } from './dto/bulk-update-user.dto';
import { DataSource } from 'typeorm';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { Branch } from '../branch/entities/branch.entity';
import { OrganisationHoursService } from '../organisation/services/organisation-hours.service';
import { Device } from '../iot/entities/iot.entity';
import { ClerkService } from '../clerk/clerk.service';

@Injectable()
export class UserService {
	private readonly logger = new Logger(UserService.name);
	private readonly CACHE_PREFIX = 'users:';
	private readonly CACHE_TTL: number;
	private readonly TARGET_CACHE_TTL: number; // Longer TTL for targets (less volatile)
	private readonly activeCalculations = new Map<number, Promise<void>>();

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(UserTarget)
		private userTargetRepository: Repository<UserTarget>,
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		@InjectRepository(Order)
		private orderRepository: Repository<Order>,
		@InjectRepository(Lead)
		private leadRepository: Repository<Lead>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly eventEmitter: EventEmitter2,
		private readonly configService: ConfigService,
		private readonly dataSource: DataSource,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		@InjectRepository(Branch)
		private branchRepository: Repository<Branch>,
		private readonly organisationHoursService: OrganisationHoursService,
		@InjectRepository(Device)
		private deviceRepository: Repository<Device>,
		private readonly clerkService: ClerkService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
		this.TARGET_CACHE_TTL = this.configService.get<number>('TARGET_CACHE_EXPIRATION_TIME') || 60; // 60 seconds for targets
		this.logger.log('UserService initialized with cache TTL: ' + this.CACHE_TTL + 's, target cache TTL: ' + this.TARGET_CACHE_TTL + 's');
	}

	/**
	 * Generate cache key with consistent prefix
	 * @param key - The key identifier (uid, email, username, etc.)
	 * @returns Formatted cache key with prefix
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Build query builder with standard user relationships for PostgreSQL compatibility
	 * Uses explicit leftJoinAndSelect instead of relations array for better performance and reliability
	 * @param queryBuilder - The query builder to enhance
	 * @param includeTarget - Whether to include userTarget relationship
	 * @param includeProfile - Whether to include userProfile relationship
	 * @param includeEmploymentProfile - Whether to include userEmployeementProfile relationship
	 * @param includeRewards - Whether to include rewards relationship
	 * @returns Enhanced query builder with relationships loaded
	 */
	private buildUserQueryWithRelations(
		queryBuilder: any,
		includeTarget: boolean = false,
		includeProfile: boolean = false,
		includeEmploymentProfile: boolean = false,
		includeRewards: boolean = false,
	): any {
		queryBuilder
			.leftJoinAndSelect('user.organisation', 'organisation')
			.leftJoinAndSelect('user.branch', 'branch');

		if (includeTarget) {
			queryBuilder.leftJoinAndSelect('user.userTarget', 'userTarget');
		}

		if (includeProfile) {
			queryBuilder.leftJoinAndSelect('user.userProfile', 'userProfile');
		}

		if (includeEmploymentProfile) {
			queryBuilder.leftJoinAndSelect('user.userEmployeementProfile', 'userEmployeementProfile');
		}

		if (includeRewards) {
			queryBuilder.leftJoinAndSelect('user.rewards', 'rewards');
		}

		return queryBuilder;
	}

	/**
	 * Get organization timezone for user
	 * @param user - User entity with organization relation
	 * @returns Safe timezone string
	 */
	private async getOrganizationTimezone(user: User): Promise<string> {
		if (!user?.organisation?.uid) {
			return 'Africa/Johannesburg';
		}

		try {
			const organizationHours = await this.organisationHoursService.findDefault(String(user.organisation.uid));
			return organizationHours?.timezone || 'Africa/Johannesburg';
		} catch (error) {
			this.logger.warn(`Error getting timezone for user ${user.uid} org ${user.organisation?.uid}, using default:`, error);
			return 'Africa/Johannesburg';
		}
	}
	/**
	 * Format time in user's organization timezone
	 * @param date - Date to format
	 * @param user - User entity with organization relation
	 * @param format - Date format string (default: 'PPPp')
	 * @returns Formatted time string in organization timezone
	 */
	private async formatTimeInUserTimezone(date: Date, user: User, format: string = 'PPPp'): Promise<string> {
		const timezone = await this.getOrganizationTimezone(user);
		return formatInTimeZone(date, timezone, format);
	}

	/**
	 * Safely parses a number from various input types (string, number, decimal)
	 * @param value - The value to parse
	 * @returns Parsed number or 0 if invalid
	 */
	private safeParseNumber(value: any): number {
		if (value === null || value === undefined) {
			return 0;
		}

		if (typeof value === 'number') {
			return isNaN(value) ? 0 : value;
		}

		if (typeof value === 'string') {
			const parsed = parseFloat(value);
			return isNaN(parsed) ? 0 : parsed;
		}

		// Handle decimal/numeric types from database
		const numericValue = Number(value);
		return isNaN(numericValue) ? 0 : numericValue;
	}

	/**
	 * Validates calculated target values to ensure they are within reasonable bounds
	 * @param userTarget - The user target object to validate
	 * @returns True if values are valid, false otherwise
	 */
	private validateCalculatedValues(userTarget: UserTarget): boolean {
		try {
			// Check for invalid numeric values
			if (userTarget.currentSalesAmount !== null && userTarget.currentSalesAmount !== undefined) {
				if (isNaN(userTarget.currentSalesAmount) || userTarget.currentSalesAmount < 0) {
					this.logger.warn('Invalid currentSalesAmount detected');
					return false;
				}
				// Check for unreasonably large values (e.g., over 10 million)
				if (userTarget.currentSalesAmount > 10000000) {
					this.logger.warn('Unreasonably large currentSalesAmount detected');
					return false;
				}
			}

			if (userTarget.currentQuotationsAmount !== null && userTarget.currentQuotationsAmount !== undefined) {
				if (isNaN(userTarget.currentQuotationsAmount) || userTarget.currentQuotationsAmount < 0) {
					this.logger.warn('Invalid currentQuotationsAmount detected');
					return false;
				}
				if (userTarget.currentQuotationsAmount > 10000000) {
					this.logger.warn('Unreasonably large currentQuotationsAmount detected');
					return false;
				}
			}

			if (userTarget.currentOrdersAmount !== null && userTarget.currentOrdersAmount !== undefined) {
				if (isNaN(userTarget.currentOrdersAmount) || userTarget.currentOrdersAmount < 0) {
					this.logger.warn('Invalid currentOrdersAmount detected');
					return false;
				}
				if (userTarget.currentOrdersAmount > 10000000) {
					this.logger.warn('Unreasonably large currentOrdersAmount detected');
					return false;
				}
			}

			// Check for negative counts
			if (userTarget.currentNewLeads !== null && userTarget.currentNewLeads !== undefined) {
				if (userTarget.currentNewLeads < 0) {
					this.logger.warn('Invalid currentNewLeads detected');
					return false;
				}
			}

			if (userTarget.currentNewClients !== null && userTarget.currentNewClients !== undefined) {
				if (userTarget.currentNewClients < 0) {
					this.logger.warn('Invalid currentNewClients detected');
					return false;
				}
			}

			if (userTarget.currentCheckIns !== null && userTarget.currentCheckIns !== undefined) {
				if (userTarget.currentCheckIns < 0) {
					this.logger.warn('Invalid currentCheckIns detected');
					return false;
				}
			}

			return true;
		} catch (error) {
			this.logger.error(`Error validating calculated values: ${error.message}`);
			return false;
		}
	}

	/**
	 * Calculate working days remaining based on organization working hours
	 * @param endDate - The target end date
	 * @param organizationRef - Organization reference to get working schedule
	 * @returns Number of working days remaining (positive) or overdue (negative)
	 */
	private async calculateWorkingDaysRemaining(endDate: Date, organizationRef?: string): Promise<number> {
		try {
			const currentDate = new Date();
			currentDate.setHours(0, 0, 0, 0); // Start of current day
			const targetDate = new Date(endDate);
			targetDate.setHours(0, 0, 0, 0); // Start of target day

			// Determine if we're calculating remaining days (positive) or overdue days (negative)
			const isOverdue = targetDate < currentDate;
			const startDate = isOverdue ? targetDate : currentDate;
			const calculationEndDate = isOverdue ? currentDate : targetDate;

			let workingDays = 0;

			// If no organization reference, fall back to simple business days (Mon-Sat)
			if (!organizationRef) {
				workingDays = this.calculateSimpleBusinessDays(startDate, calculationEndDate);
			} else {
				// Get organization hours to determine working schedule
				let orgHours;
				try {
					orgHours = await this.organisationHoursService.findDefault(organizationRef);
				} catch (error) {
					this.logger.warn(`Could not fetch organization hours for ${organizationRef}, falling back to default business days: ${error.message}`);
					workingDays = this.calculateSimpleBusinessDays(startDate, calculationEndDate);
				}

				if (!orgHours) {
					this.logger.warn(`No organization hours found for ${organizationRef}, falling back to default business days`);
					workingDays = this.calculateSimpleBusinessDays(startDate, calculationEndDate);
				} else {
					// Calculate working days based on organization schedule
					workingDays = this.calculateWorkingDaysWithSchedule(startDate, calculationEndDate, orgHours);
				}
			}

			// Return negative value for overdue, positive for remaining
			return isOverdue ? -workingDays : workingDays;

		} catch (error) {
			this.logger.error(`Error calculating working days remaining: ${error.message}`);
			// Fall back to simple calculation
			const currentDate = new Date();
			const targetDate = new Date(endDate);
			const isOverdue = targetDate < currentDate;
			const simpleDays = this.calculateSimpleBusinessDays(
				isOverdue ? targetDate : currentDate,
				isOverdue ? currentDate : targetDate
			);
			return isOverdue ? -simpleDays : simpleDays;
		}
	}

	/**
	 * Calculate simple business days (Monday to Saturday, excluding Sundays)
	 * @param startDate - Start date
	 * @param endDate - End date
	 * @returns Number of business days
	 */
	private calculateSimpleBusinessDays(startDate: Date, endDate: Date): number {
		let workingDays = 0;
		const currentDate = new Date(startDate);

		// Fix: Include end date by using <= instead of <
		while (currentDate <= endDate) {
			const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
			
			// Count Monday (1) through Saturday (6), exclude Sunday (0)
			if (dayOfWeek !== 0) {
				workingDays++;
			}

			currentDate.setDate(currentDate.getDate() + 1);
		}

		return workingDays;
	}

	/**
	 * Calculate working days based on organization schedule
	 * @param startDate - Start date
	 * @param endDate - End date
	 * @param orgHours - Organization hours configuration
	 * @returns Number of working days
	 */
	private calculateWorkingDaysWithSchedule(startDate: Date, endDate: Date, orgHours: any): number {
		let workingDays = 0;
		const currentDate = new Date(startDate);

		// Handle holiday mode
		if (orgHours.holidayMode && orgHours.holidayUntil) {
			const holidayEndDate = new Date(orgHours.holidayUntil);
			if (currentDate <= holidayEndDate) {
				// If we're currently in holiday mode, start counting from after holiday period
				currentDate.setTime(Math.max(currentDate.getTime(), holidayEndDate.getTime() + 24 * 60 * 60 * 1000));
			}
		}

		// Get working schedule - prefer detailed schedule, fall back to weeklySchedule
		const schedule = orgHours.schedule || this.convertWeeklyScheduleToDetailed(orgHours.weeklySchedule);
		
		// Days mapping: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
		const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

		while (currentDate < endDate) {
			const dayOfWeek = currentDate.getDay();
			const dayName = dayNames[dayOfWeek];
			
			// Check if this day is a working day according to schedule
			const daySchedule = schedule[dayName];
			let isWorkingDay = false;

			if (daySchedule) {
				// If using detailed schedule, check if day is not marked as closed
				if (typeof daySchedule === 'object' && 'closed' in daySchedule) {
					isWorkingDay = !daySchedule.closed;
				} else if (typeof daySchedule === 'boolean') {
					// If using simple boolean schedule
					isWorkingDay = daySchedule;
				}
			}

			// Check for special hours on this specific date
			if (isWorkingDay && orgHours.specialHours && Array.isArray(orgHours.specialHours)) {
				const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format
				const specialHour = orgHours.specialHours.find(sh => sh.date === dateStr);
				
				if (specialHour) {
					// If there's special hours for this date, check if it's actually a working day
					// Special hours with null/empty times might indicate closure
					isWorkingDay = !!(specialHour.openTime && specialHour.closeTime);
				}
			}

			if (isWorkingDay) {
				workingDays++;
			}

			currentDate.setDate(currentDate.getDate() + 1);
		}

		return workingDays;
	}

	/**
	 * Convert simple weeklySchedule to detailed schedule format
	 * @param weeklySchedule - Simple boolean schedule
	 * @returns Detailed schedule format
	 */
	private convertWeeklyScheduleToDetailed(weeklySchedule: any): any {
		if (!weeklySchedule) {
			// Default to Monday-Saturday if no schedule provided
			return {
				sunday: { closed: true },
				monday: { closed: false },
				tuesday: { closed: false },
				wednesday: { closed: false },
				thursday: { closed: false },
				friday: { closed: false },
				saturday: { closed: false },
			};
		}

		const detailed: any = {};
		Object.keys(weeklySchedule).forEach(day => {
			detailed[day] = { closed: !weeklySchedule[day] };
		});

		return detailed;
	}

	/**
	 * Audit and potentially fix historical data integrity issues
	 * This method can be called manually to investigate data corruption
	 */
	async auditUserTargetData(userId: number): Promise<{
		hasIssues: boolean;
		issues: string[];
		recommendations: string[];
		historicalData?: any;
	}> {
		try {
			this.logger.log(`Starting comprehensive data audit for user: ${userId}`);

			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user?.userTarget) {
				return {
					hasIssues: false,
					issues: [],
					recommendations: ['User has no target data to audit'],
				};
			}

			const { userTarget } = user;
			const issues: string[] = [];
			const recommendations: string[] = [];

			// Audit current values against expected calculations
			const quotationsAmount = this.safeParseNumber(userTarget.currentQuotationsAmount);
			const ordersAmount = this.safeParseNumber(userTarget.currentOrdersAmount);
			const salesAmount = this.safeParseNumber(userTarget.currentSalesAmount);
			const expectedSalesAmount = quotationsAmount + ordersAmount;

			// Check for calculation inconsistencies
			if (Math.abs(expectedSalesAmount - salesAmount) > 0.01) {
				issues.push(`Sales amount mismatch: current ${salesAmount}, expected ${expectedSalesAmount}`);
				recommendations.push(`Recalculate sales amount as quotations (${quotationsAmount}) + orders (${ordersAmount})`);
			}

			// Check for unreasonable values
			if (salesAmount > 10000000) {
				issues.push(`Unreasonably large sales amount: ${salesAmount}`);
				recommendations.push('Investigate source of large sales amount - possible data duplication');
			}

			// Verify against actual database records
			const startDate = userTarget.periodStartDate;
			const endDate = new Date();

			// Count actual quotations (exclude client-placed orders)
			const actualQuotationsAmount = await this.quotationRepository
				.createQueryBuilder('quotation')
				.select('SUM(quotation.totalAmount)', 'total')
				.where('quotation.placedBy = :userId', { userId })
				.andWhere('quotation.isClientPlaced = :isClientPlaced', { isClientPlaced: false })
				.andWhere('quotation.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
				.andWhere('quotation.status IN (:...statuses)', {
					statuses: ['DRAFT', 'PENDING_INTERNAL', 'PENDING_CLIENT', 'NEGOTIATION', 'APPROVED', 'REJECTED', 'SOURCING', 'PACKING']
				})
				.getRawOne();

			const actualQuotationsTotal = this.safeParseNumber(actualQuotationsAmount?.total);

			if (Math.abs(actualQuotationsTotal - quotationsAmount) > 100) {
				issues.push(`Quotations amount mismatch: stored ${quotationsAmount}, actual ${actualQuotationsTotal}`);
				recommendations.push('Trigger recalculation from database records');
			}

			return {
				hasIssues: issues.length > 0,
				issues,
				recommendations,
				historicalData: {
					storedValues: {
						quotations: quotationsAmount,
						orders: ordersAmount,
						sales: salesAmount,
					},
					calculatedValues: {
						expectedSales: expectedSalesAmount,
						actualQuotationsFromDB: actualQuotationsTotal,
					},
					period: {
						start: startDate,
						end: endDate,
						lastCalculated: (userTarget as any).lastCalculatedAt,
					},
				},
			};
		} catch (error) {
			this.logger.error(`Failed to audit user target data for user ${userId}: ${error.message}`, error.stack);
			return {
				hasIssues: true,
				issues: [`Audit failed: ${error.message}`],
				recommendations: ['Manual investigation required'],
			};
		}
	}

	/**
	 * Comprehensive cache invalidation for user-related data
	 * Clears all relevant cache entries when user data changes
	 * @param user - User entity to invalidate cache for
	 */
	private async invalidateUserCache(user: User) {
		try {

			// Get all cache keys
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// Add user-specific keys
			keysToDelete.push(
				this.getCacheKey(user.uid),
				this.getCacheKey(user.email),
				this.getCacheKey(user.username),
				`${this.CACHE_PREFIX}all`,
				`${this.CACHE_PREFIX}stats`,
			);

			// Add organization and branch specific keys
			if (user.organisation?.uid) {
				keysToDelete.push(`${this.CACHE_PREFIX}org_${user.organisation.uid}`);
			}
			if (user.branch?.uid) {
				keysToDelete.push(`${this.CACHE_PREFIX}branch_${user.branch.uid}`);
			}

			// Add access level specific keys
			if (user.accessLevel) {
				keysToDelete.push(`${this.CACHE_PREFIX}access_${user.accessLevel}`);
			}

			// Add status specific keys
			if (user.status) {
				keysToDelete.push(`${this.CACHE_PREFIX}status_${user.status}`);
			}

			// Clear all pagination and filtered user list caches
			const userListCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}page`) || key.includes('_limit') || key.includes('_filter'),
			);
			keysToDelete.push(...userListCaches);

			// Clear all caches
			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));


			// Emit event for other services that might be caching user data
			this.eventEmitter.emit('users.cache.invalidate', {
				userId: user.uid,
				keys: keysToDelete,
			});
		} catch (error) {
			this.logger.error(`Error invalidating user cache for user ${user.uid}:`, error.message);
		}
	}

	/**
	 * Populate assigned clients with full client data
	 * @param user - User with assignedClientIds
	 * @returns User with populated assignedClients
	 */
	private async populateAssignedClients(user: User): Promise<User & { assignedClients?: Client[] }> {
		if (!user.assignedClientIds || user.assignedClientIds.length === 0) {
			return { ...user, assignedClients: [] };
		}

		try {
			// Add timeout and better error handling for client population
			const queryTimeout = 5000; // 5 seconds timeout
			const clients = await Promise.race([
				this.clientRepository.find({
					where: {
						uid: In(user.assignedClientIds),
						isDeleted: false,
					},
					select: ['uid', 'name', 'contactPerson', 'email', 'phone', 'status', 'createdAt'],
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Client query timeout')), queryTimeout),
				),
			]);

			return { ...user, assignedClients: clients };
		} catch (error) {
			this.logger.warn(`Failed to populate assigned clients for user ${user.uid}: ${error.message}`);
			// Return user with empty clients array instead of failing the entire operation
			return { ...user, assignedClients: [] };
		}
	}

	/**
	 * Populate assigned clients for user data
	 * @param user - User entity
	 * @returns User data with assigned clients
	 */
	private async excludePasswordAndPopulateClients(
		user: User,
	): Promise<User & { assignedClients?: Client[] }> {
		return await this.populateAssignedClients(user);
	}

	/**
	 * Return user data (legacy method for backward compatibility - password removed)
	 * @param user - User entity
	 * @returns User data
	 */
	private excludePassword(user: User): User {
		return user;
	}

	/**
	 * Validate managedDoors array - ensure all device IDs exist and belong to user's organization
	 */
	private async validateManagedDoors(deviceIds: number[], orgRef?: string): Promise<void> {
		if (!deviceIds || deviceIds.length === 0) {
			return; // Empty array is valid
		}

		// Get all devices with these IDs
		const devices = await this.deviceRepository.find({
			where: {
				id: In(deviceIds),
				isDeleted: false,
			},
			select: ['id', 'orgID', 'deviceID'],
		});

		// Check if all requested devices exist
		const foundIds = new Set(devices.map(d => d.id));
		const missingIds = deviceIds.filter(id => !foundIds.has(id));
		
		if (missingIds.length > 0) {
			throw new BadRequestException(
				`Invalid device IDs in managedDoors: [${missingIds.join(', ')}]. These devices do not exist or have been deleted.`
			);
		}

		// If orgRef provided, validate devices belong to organization
		if (orgRef) {
			const orgId = parseInt(orgRef, 10);
			if (!isNaN(orgId)) {
				const invalidDevices = devices.filter(d => d.orgID !== orgId);
				if (invalidDevices.length > 0) {
					const invalidIds = invalidDevices.map(d => d.id);
					throw new BadRequestException(
						`Device IDs [${invalidIds.join(', ')}] do not belong to your organization.`
					);
				}
			}
		}

	}

	/**
	 * Create a new user with optional organization and branch assignment
	 * Includes password hashing, cache invalidation, and welcome email
	 * @param createUserDto - User creation data
	 * @param orgId - Optional organization ID to assign user
	 * @param branchId - Optional branch ID to assign user
	 * @returns Success message or error details
	 */
	async create(createUserDto: CreateUserDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[USER_CREATION] Starting user creation for: ${createUserDto.email}`);

		const maxRetries = 3;
		let attempt = 0;
		const originalUserref = createUserDto.userref;

		while (attempt < maxRetries) {
			try {
				// Reset userref if it was cleared for retry
				if (!createUserDto.userref && originalUserref) {
					createUserDto.userref = originalUserref;
			}

			// Generate user reference if not provided, with collision check
			if (!createUserDto.userref) {
					let userref: string;
					let userrefAttempts = 0;
					const maxUserrefAttempts = 10;
					
					do {
						userref = `USR${Math.floor(100000 + Math.random() * 900000)}`;
						userrefAttempts++;
						
						// Check if userref already exists
						const existingUser = await this.userRepository.findOne({
							where: { userref },
							select: ['uid'],
						});
						
						if (!existingUser) {
							break;
						}
						
						if (userrefAttempts >= maxUserrefAttempts) {
							throw new Error('Failed to generate unique user reference after multiple attempts');
						}
					} while (true);
					
					createUserDto.userref = userref;
				} else {
					// Check if provided userref already exists
					const existingUser = await this.userRepository.findOne({
						where: { userref: createUserDto.userref },
						select: ['uid'],
					});
					
					if (existingUser) {
						throw new ConflictException(`User reference '${createUserDto.userref}' already exists`);
					}
			}

			// Set default profile picture if not provided
			const DEFAULT_PROFILE_PICTURE_URL = 'https://cdn-icons-png.flaticon.com/128/1144/1144709.png';
			if (!createUserDto.photoURL) {
				createUserDto.photoURL = DEFAULT_PROFILE_PICTURE_URL;
			}

			// Create the user entity with proper relationship setting
			const user = this.userRepository.create({
				...createUserDto,
				...(orgId && {
					organisation: { uid: orgId },
					organisationRef: orgId.toString(),
				}),
				...(branchId && {
					branch: { uid: branchId },
				}),
			});

			const savedUser = await this.userRepository.save(user);

			if (!savedUser) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

				this.logger.log(`[USER_CREATION] User created successfully: ${savedUser.uid} (${savedUser.email})`);

			// Invalidate cache after creation
			await this.invalidateUserCache(savedUser);

			// Send welcome and creation notification emails
			const emailPromises = [this.sendWelcomeEmail(savedUser)];

			// Check if user has assigned clients for client assignment notification
			if (createUserDto.assignedClientIds && createUserDto.assignedClientIds.length > 0) {
				emailPromises.push(
					this.sendUserCreationWithClientsNotificationEmail(savedUser, createUserDto.assignedClientIds),
				);
			} else {
				emailPromises.push(this.sendUserCreationNotificationEmail(savedUser));
			}

			// Send push notification for user creation
			try {
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.USER_CREATED,
					[savedUser.uid],
					{
						userName: `${savedUser.name} ${savedUser.surname || ''}`.trim(),
						userRole: savedUser.accessLevel,
						organizationName: savedUser.organisation?.name || 'Your Organization',
						branchName: savedUser.branch?.name || 'Main Branch',
					},
					{
						priority: NotificationPriority.HIGH,
					},
				);
			} catch (notificationError) {
					this.logger.warn(`Failed to send push notification to user ${savedUser.uid}`);
			}

			await Promise.all(emailPromises);

			const executionTime = Date.now() - startTime;
				this.logger.log(`[USER_CREATION] Completed in ${executionTime}ms for: ${savedUser.email}`);

				return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
				attempt++;
			const executionTime = Date.now() - startTime;
				
				// Handle QueryFailedError specifically for primary key violations
				if (error instanceof QueryFailedError) {
					const errorMessage = error.message.toLowerCase();
					
					// Check if it's a primary key constraint violation
					if (errorMessage.includes('duplicate key') && errorMessage.includes('pk_')) {
						this.logger.warn(`[USER_CREATION] Primary key violation (attempt ${attempt}/${maxRetries})`);
						
						// If it's the first attempt, try to fix the sequence
						if (attempt === 1) {
							try {
								await this.syncUserSequence();
								this.logger.log('[USER_CREATION] Sequence synchronized, retrying');
								continue; // Retry the operation
							} catch (syncError) {
								this.logger.error(`[USER_CREATION] Failed to sync sequence: ${syncError.message}`);
							}
						}
						
						// If we've exhausted retries, throw a user-friendly error
						if (attempt >= maxRetries) {
							this.logger.error(`[USER_CREATION] Failed after ${maxRetries} attempts`);
							throw new ConflictException(
								'Failed to create user due to database constraint violation. Please try again or contact support.',
							);
						}
						
						// Wait before retrying (exponential backoff)
						await new Promise(resolve => setTimeout(resolve, 100 * attempt));
						continue;
					}
					
					// Handle unique constraint violations (email, username, userref)
					if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
						if (errorMessage.includes('email') || errorMessage.includes('users_email_key')) {
							throw new ConflictException(`User with email '${createUserDto.email}' already exists`);
						}
						if (errorMessage.includes('username') || errorMessage.includes('users_username_key')) {
							throw new ConflictException(`Username '${createUserDto.username}' is already taken`);
						}
						if (errorMessage.includes('userref')) {
							// Regenerate userref and retry if not on last attempt
							if (attempt < maxRetries) {
								this.logger.warn(`[USER_CREATION] Userref collision, regenerating (attempt ${attempt})`);
								createUserDto.userref = undefined; // Will be regenerated in next attempt
								await new Promise(resolve => setTimeout(resolve, 50 * attempt));
								continue;
							}
							throw new ConflictException(`User reference '${createUserDto.userref}' already exists`);
						}
					}
					
					// Handle foreign key constraint violations
					if (errorMessage.includes('foreign key constraint')) {
						const constraintName = error.message.match(/constraint "([^"]+)"/)?.[1] || 'unknown';
						if (errorMessage.includes('organisation') || errorMessage.includes('organization')) {
							throw new BadRequestException(`Invalid organization reference. Please ensure the organization exists.`);
						}
						if (errorMessage.includes('branch')) {
							throw new BadRequestException(`Invalid branch reference. Please ensure the branch exists and belongs to the specified organization.`);
						}
						throw new BadRequestException(`Database constraint violation: ${constraintName}. Please verify all referenced entities exist.`);
					}
				}
				
				// Re-throw HTTP exceptions (ConflictException, BadRequestException, etc.)
				if (error instanceof ConflictException || error instanceof BadRequestException || error instanceof NotFoundException) {
					throw error;
				}
				
				// Log and throw for other errors
				this.logger.error(`[USER_CREATION] Failed after ${executionTime}ms: ${error.message}`);

				return {
					message: error?.message || 'Failed to create user. Please try again.',
				};
			}
		}
		
		throw new Error('Failed to create user after maximum retry attempts');
	}

	/**
	 * Synchronize the user sequence with the current max uid
	 * This fixes cases where the sequence is out of sync with actual data
	 */
	private async syncUserSequence(): Promise<void> {
		try {
			// Get the current max uid from the database
			const result = await this.userRepository
				.createQueryBuilder('user')
				.select('MAX(user.uid)', 'maxUid')
				.getRawOne();
			
			const maxUid = result?.maxUid || 0;
			const nextUid = maxUid + 1;
			
			// Reset the sequence to the next available uid
			await this.dataSource.query(
				`SELECT setval('users_uid_seq', $1, false)`,
				[nextUid]
			);
			
			this.logger.log(`[USER_CREATION] Sequence synced: maxUid=${maxUid}, nextUid=${nextUid}`);
		} catch (error) {
			this.logger.error(`[USER_CREATION] Error syncing sequence: ${error.message}`);
			throw error;
		}
	}

	/**
	 * 👥 Create multiple users in bulk with transaction support
	 * @param bulkCreateUserDto - Bulk user creation data
	 * @returns Promise with bulk creation results
	 */
	async createBulkUsers(bulkCreateUserDto: BulkCreateUserDto): Promise<BulkCreateUserResponse> {
		const startTime = Date.now();
		this.logger.log(`👥 [createBulkUsers] Starting bulk creation of ${bulkCreateUserDto.users.length} users`);

		const results: BulkUserResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		let welcomeEmailsSent = 0;
		const errors: string[] = [];
		const createdUserIds: number[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkCreateUserDto.users.length; i++) {
				const userData = bulkCreateUserDto.users[i];

				try {

					// Check if username already exists
					const existingUsername = await queryRunner.manager.findOne(User, {
						where: { username: userData.username },
					});
					if (existingUsername) {
						throw new Error(`Username '${userData.username}' already exists`);
					}

					// Check if email already exists
					const existingEmail = await queryRunner.manager.findOne(User, {
						where: { email: userData.email },
					});
					if (existingEmail) {
						throw new Error(`Email '${userData.email}' already exists`);
					}

					// Generate user reference if not provided
					const userref = userData.userref || `USR${Math.floor(100000 + Math.random() * 900000)}`;

					// Create user with org and branch association
					// Note: Password is managed by Clerk, not stored in database
					const user = queryRunner.manager.create(User, {
						...userData,
						userref,
						...(bulkCreateUserDto.orgId && { organisation: { uid: bulkCreateUserDto.orgId } }),
						...(bulkCreateUserDto.branchId && { branch: { uid: bulkCreateUserDto.branchId } }),
						status: userData.status || 'active',
						accessLevel: userData.accessLevel || AccessLevel.USER,
						role: userData.role || 'user',
						isDeleted: false,
						createdAt: new Date(),
						updatedAt: new Date(),
					});

					const savedUser = await queryRunner.manager.save(User, user);

					results.push({
						user: savedUser,
						success: true,
						index: i,
						username: userData.username,
						email: userData.email,
					});

					successCount++;
					createdUserIds.push(savedUser.uid);
				} catch (userError) {
					const errorMessage = `User ${i + 1} (${userData.username || userData.email}): ${userError.message}`;
					this.logger.error(`❌ [createBulkUsers] ${errorMessage}`, userError.stack);

					results.push({
						user: null,
						success: false,
						error: userError.message,
						index: i,
						username: userData.username,
						email: userData.email,
					});

					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(
					`✅ [createBulkUsers] Transaction committed - ${successCount} users created successfully`,
				);

				// Clear relevant caches after successful bulk creation
				await this.cacheManager.del(`${this.CACHE_PREFIX}all`);

				// Send welcome emails if requested
				if (bulkCreateUserDto.sendWelcomeEmails !== false && successCount > 0) {

					for (const result of results) {
						if (result.success && result.user) {
							try {
								await this.sendUserCreationNotificationEmail(result.user);
								welcomeEmailsSent++;
							} catch (emailError) {
								this.logger.warn(
									`⚠️ [createBulkUsers] Failed to send welcome email to ${result.user.email}: ${emailError.message}`,
								);
							}
						}
					}

					this.logger.log(`📧 [createBulkUsers] Sent ${welcomeEmailsSent} welcome emails`);
				}

				// Emit bulk creation event
				this.eventEmitter.emit('users.bulk.created', {
					totalRequested: bulkCreateUserDto.users.length,
					totalCreated: successCount,
					totalFailed: failureCount,
					createdUserIds,
					orgId: bulkCreateUserDto.orgId,
					branchId: bulkCreateUserDto.branchId,
					timestamp: new Date(),
				});
			} else {
				// Rollback if no users were created successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [createBulkUsers] Transaction rolled back - no users were created successfully`);
			}
		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(
				`❌ [createBulkUsers] Transaction error: ${transactionError.message}`,
				transactionError.stack,
			);

			return {
				totalRequested: bulkCreateUserDto.users.length,
				totalCreated: 0,
				totalFailed: bulkCreateUserDto.users.length,
				successRate: 0,
				results: [],
				message: `Bulk creation failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime,
				createdUserIds: [],
				welcomeEmailsSent: 0,
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkCreateUserDto.users.length) * 100;

		this.logger.log(
			`🎉 [createBulkUsers] Bulk creation completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(
				2,
			)}%, Emails: ${welcomeEmailsSent}`,
		);

		return {
			totalRequested: bulkCreateUserDto.users.length,
			totalCreated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message:
				successCount > 0
					? `Bulk creation completed: ${successCount} users created, ${failureCount} failed`
					: 'Bulk creation failed: No users were created',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			createdUserIds: createdUserIds.length > 0 ? createdUserIds : undefined,
			welcomeEmailsSent: welcomeEmailsSent > 0 ? welcomeEmailsSent : undefined,
		};
	}

	/**
	 * 📝 Update multiple users in bulk with transaction support
	 * @param bulkUpdateUserDto - Bulk user update data
	 * @returns Promise with bulk update results
	 */
	async updateBulkUsers(bulkUpdateUserDto: BulkUpdateUserDto): Promise<BulkUpdateUserResponse> {
		const startTime = Date.now();
		this.logger.log(`📝 [updateBulkUsers] Starting bulk update of ${bulkUpdateUserDto.updates.length} users`);

		const results: BulkUpdateUserResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		let notificationEmailsSent = 0;
		const errors: string[] = [];
		const updatedUserIds: number[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkUpdateUserDto.updates.length; i++) {
				const updateItem = bulkUpdateUserDto.updates[i];
				const { ref, data } = updateItem;

				try {
					this.logger.debug(
						`👤 [updateBulkUsers] Processing user ${i + 1}/${bulkUpdateUserDto.updates.length}: ID ${ref}`,
					);

					// First find the user to ensure it exists
					const existingUser = await queryRunner.manager
						.createQueryBuilder(User, 'user')
						.leftJoinAndSelect('user.organisation', 'organisation')
						.leftJoinAndSelect('user.branch', 'branch')
						.where('user.uid = :ref', { ref })
						.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
						.getOne();

					if (!existingUser) {
						throw new Error(`User with ID ${ref} not found`);
					}


					// Track original values for change detection
					const originalValues = {
						role: existingUser.role,
						status: existingUser.status,
						accessLevel: existingUser.accessLevel,
						assignedClientIds: existingUser.assignedClientIds,
					};

					// Validate assigned client IDs if provided and validation is enabled
					if (data.assignedClientIds && bulkUpdateUserDto.validateClientIds !== false) {

						const existingClients = await queryRunner.manager.find(Client, {
							where: { uid: In(data.assignedClientIds), isDeleted: false },
							select: ['uid'],
						});

						if (existingClients.length !== data.assignedClientIds.length) {
							const foundIds = existingClients.map((c) => c.uid);
							const invalidIds = data.assignedClientIds.filter((id) => !foundIds.includes(id));
							throw new Error(`Invalid client IDs: ${invalidIds.join(', ')}`);
						}
					}

					// Note: Password is managed by Clerk, not updated here
					let updateData = { ...data };

					// Track changed fields for logging and notifications
					const updatedFields = Object.keys(data).filter(
						(key) => data[key] !== undefined && data[key] !== existingUser[key],
					);

					// Update the user
					updateData.updatedAt = new Date();
					await queryRunner.manager.update(User, ref, updateData);

					// Check for significant changes that require notifications
					const hasSignificantChanges =
						(data.role && data.role !== originalValues.role) ||
						(data.status && data.status !== originalValues.status) ||
						(data.accessLevel && data.accessLevel !== originalValues.accessLevel);

					results.push({
						ref,
						success: true,
						index: i,
						username: existingUser.username,
						email: existingUser.email,
						updatedFields,
					});

					successCount++;
					updatedUserIds.push(ref);

					// Send notification email for significant changes if enabled
					if (hasSignificantChanges && bulkUpdateUserDto.sendNotificationEmails !== false) {
						try {
							// Get updated user for email
							const updatedUser = await queryRunner.manager
								.createQueryBuilder(User, 'user')
								.leftJoinAndSelect('user.organisation', 'organisation')
								.leftJoinAndSelect('user.branch', 'branch')
								.where('user.uid = :ref', { ref })
								.getOne();

							if (updatedUser) {
								await this.sendComprehensiveUserUpdateEmail(
									updatedUser,
									existingUser,
									{
										role: data.role !== originalValues.role,
										status: data.status !== originalValues.status,
										profile: updatedFields.some((field) =>
											['name', 'surname', 'phone', 'photoURL'].includes(field),
										),
										assignedClients:
											JSON.stringify(data.assignedClientIds) !==
											JSON.stringify(originalValues.assignedClientIds),
									},
									originalValues.assignedClientIds || [],
									data.assignedClientIds || updatedUser.assignedClientIds || [],
								);
								notificationEmailsSent++;
							}
						} catch (emailError) {
							this.logger.warn(
								`⚠️ [updateBulkUsers] Failed to send notification email to ${existingUser.email}: ${emailError.message}`,
							);
						}
					}
				} catch (userError) {
					const errorMessage = `User ID ${ref}: ${userError.message}`;
					this.logger.error(`❌ [updateBulkUsers] ${errorMessage}`, userError.stack);

					results.push({
						ref,
						success: false,
						error: userError.message,
						index: i,
					});

					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(
					`✅ [updateBulkUsers] Transaction committed - ${successCount} users updated successfully`,
				);

				// Invalidate relevant caches after successful bulk update
				await this.cacheManager.del(`${this.CACHE_PREFIX}all`);

				// Clear specific user caches for updated users
				await Promise.all(updatedUserIds.map((userId) => this.cacheManager.del(this.getCacheKey(userId))));

				// Emit bulk update event
				this.eventEmitter.emit('users.bulk.updated', {
					totalRequested: bulkUpdateUserDto.updates.length,
					totalUpdated: successCount,
					totalFailed: failureCount,
					updatedUserIds,
					notificationEmailsSent,
					timestamp: new Date(),
				});
			} else {
				// Rollback if no users were updated successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [updateBulkUsers] Transaction rolled back - no users were updated successfully`);
			}
		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(
				`❌ [updateBulkUsers] Transaction error: ${transactionError.message}`,
				transactionError.stack,
			);

			return {
				totalRequested: bulkUpdateUserDto.updates.length,
				totalUpdated: 0,
				totalFailed: bulkUpdateUserDto.updates.length,
				successRate: 0,
				results: [],
				message: `Bulk update failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime,
				updatedUserIds: [],
				notificationEmailsSent: 0,
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkUpdateUserDto.updates.length) * 100;

		this.logger.log(
			`🎉 [updateBulkUsers] Bulk update completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(
				2,
			)}%, Emails: ${notificationEmailsSent}`,
		);

		return {
			totalRequested: bulkUpdateUserDto.updates.length,
			totalUpdated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message:
				successCount > 0
					? `Bulk update completed: ${successCount} users updated, ${failureCount} failed`
					: 'Bulk update failed: No users were updated',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			updatedUserIds: updatedUserIds.length > 0 ? updatedUserIds : undefined,
			notificationEmailsSent: notificationEmailsSent > 0 ? notificationEmailsSent : undefined,
		};
	}

	/**
	 * 🔐 Generate a random password for auto-generation
	 * @deprecated Password is now managed by Clerk, not stored in database
	 * @returns Random secure password (for legacy compatibility only)
	 */
	private generateRandomPassword(): string {
		// Password generation removed - passwords are managed by Clerk
		throw new Error('Password generation is no longer supported. Passwords are managed by Clerk.');
	}

	/**
	 * Retrieve paginated list of users with advanced filtering capabilities
	 * Supports filtering by status, access level, organization, branch, and search terms
	 * @param filters - Optional filters for user search
	 * @param page - Page number for pagination (default: 1)
	 * @param limit - Number of users per page (default: from env)
	 * @returns Paginated response with user data and metadata
	 */
	async findAll(
		filters?: {
			status?: AccountStatus;
			accessLevel?: AccessLevel;
			search?: string;
			branchId?: number;
			organisationId?: number;
			orgId?: string;
			userBranchId?: number;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
	): Promise<PaginatedResponse<Omit<User, 'password'>>> {
		const startTime = Date.now();

		try {
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoin('user.userTarget', 'userTarget')
				.addSelect([
					'userTarget.uid',
					'userTarget.targetSalesAmount',
					'userTarget.currentSalesAmount',
					'userTarget.targetQuotationsAmount',
					'userTarget.currentQuotationsAmount',
					'userTarget.currentOrdersAmount',
					'userTarget.targetCurrency',
					'userTarget.targetHoursWorked',
					'userTarget.currentHoursWorked',
					'userTarget.targetNewClients',
					'userTarget.currentNewClients',
					'userTarget.targetNewLeads',
					'userTarget.currentNewLeads',
					'userTarget.targetCheckIns',
					'userTarget.currentCheckIns',
					'userTarget.targetCalls',
					'userTarget.currentCalls',
					'userTarget.targetPeriod',
					'userTarget.periodStartDate',
					'userTarget.periodEndDate',
					'userTarget.createdAt',
					'userTarget.updatedAt',
				])
				.where('user.isDeleted = :isDeleted', { isDeleted: false });

			// Apply organization filter if provided
			if (filters?.orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: filters.orgId });
			}

			// Apply branch filter based on access level:
			// - If userBranchId is null: elevated user with org-wide access (no branch filter)
			// - If userBranchId is set: regular user restricted to their branch
			// - If specific branchId filter provided: override user's default branch
			if (filters?.userBranchId !== null && filters?.userBranchId !== undefined && !filters?.branchId) {
				queryBuilder.andWhere('branch.uid = :userBranchId', { userBranchId: filters.userBranchId });
			} else if (filters?.userBranchId === null) {
			}

			if (filters?.status) {
				queryBuilder.andWhere('user.status = :status', { status: filters.status });
			}

			if (filters?.accessLevel) {
				queryBuilder.andWhere('user.accessLevel = :accessLevel', { accessLevel: filters.accessLevel });
			}

			if (filters?.branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId: filters.branchId });
			}

			if (filters?.organisationId) {
				queryBuilder.andWhere('organisation.uid = :organisationId', { organisationId: filters.organisationId });
			}

			if (filters?.search) {
				queryBuilder.andWhere(
					'(LOWER(user.name) LIKE LOWER(:search) OR LOWER(user.surname) LIKE LOWER(:search) OR LOWER(user.email) LIKE LOWER(:search) OR LOWER(user.username) LIKE LOWER(:search))',
					{ search: `%${filters.search}%` },
				);
			}

			// Add pagination
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('user.createdAt', 'DESC');

			const [users, total] = await queryBuilder.getManyAndCount();

			if (!users) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const executionTime = Date.now() - startTime;

			return {
				data: await Promise.all(users.map((user) => this.excludePasswordAndPopulateClients(user))),
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Failed to fetch users after ${executionTime}ms. Error: ${error.message}`);

			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	/**
	 * Find a single user by ID with optional organization and branch scoping
	 * Includes caching for improved performance
	 * @param searchParameter - User ID to search for
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns User data without password or null with message
	 */
	async findOne(
		searchParameter: string | number,
		orgId?: string | number,
		branchId?: number,
	): Promise<{ user: Omit<User, 'password'> | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(
			`Finding user: ${searchParameter} ${orgId ? `in org: ${orgId}` : ''} ${
				branchId ? `in branch: ${branchId}` : ''
			}`,
		);

		try {
			const cacheKey = this.getCacheKey(searchParameter);
			const cachedUser = await this.cacheManager.get<User>(cacheKey);

			if (cachedUser) {

				// If org/branch filters are provided, verify cached user belongs to them
				if (orgId) {
					const orgMatches = typeof orgId === 'string' 
						? cachedUser.organisation?.clerkOrgId === orgId
						: cachedUser.organisation?.uid === orgId;
					if (!orgMatches) {
						this.logger.warn(`User ${searchParameter} found in cache but doesn't belong to org ${orgId}`);
						throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
					}
				}
				if (branchId && cachedUser.branch?.uid !== branchId) {
					this.logger.warn(`User ${searchParameter} found in cache but doesn't belong to branch ${branchId}`);
					throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
				}

				const executionTime = Date.now() - startTime;
				this.logger.log(`User ${searchParameter} retrieved from cache in ${executionTime}ms`);

				return {
					user: await this.excludePasswordAndPopulateClients(cachedUser),
					message: process.env.SUCCESS_MESSAGE,
				};
			}


			// Build where conditions (user ref as string or number; ORM/DB coercion)
			const whereConditions: any = {
				uid: searchParameter,
				isDeleted: false,
			};

			// Add organization filter if provided
			// orgId can be Clerk org ID (string) or numeric uid (number)
			if (orgId) {
				if (typeof orgId === 'string') {
					// Use clerkOrgId for relationship linking (preferred)
					whereConditions.organisation = { clerkOrgId: orgId };
				} else {
					// Fallback to numeric uid for backward compatibility
					whereConditions.organisation = { uid: Number(orgId) };
				}
			}

			// Add branch filter if provided
			if (branchId) {
				whereConditions.branch = { uid: Number(branchId) }; // 🔧 FIX: Ensure branchId is a number
			}

			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.userProfile', 'userProfile')
				.leftJoinAndSelect('user.userEmployeementProfile', 'userEmployeementProfile')
				.leftJoin('user.userTarget', 'userTarget')
				.addSelect([
					'userTarget.uid',
					'userTarget.targetSalesAmount',
					'userTarget.currentSalesAmount',
					'userTarget.targetQuotationsAmount',
					'userTarget.currentQuotationsAmount',
					'userTarget.currentOrdersAmount',
					'userTarget.targetCurrency',
					'userTarget.targetHoursWorked',
					'userTarget.currentHoursWorked',
					'userTarget.targetNewClients',
					'userTarget.currentNewClients',
					'userTarget.targetNewLeads',
					'userTarget.currentNewLeads',
					'userTarget.targetCheckIns',
					'userTarget.currentCheckIns',
					'userTarget.targetCalls',
					'userTarget.currentCalls',
					'userTarget.targetPeriod',
					'userTarget.periodStartDate',
					'userTarget.periodEndDate',
					'userTarget.createdAt',
					'userTarget.updatedAt',
				])
				.where(whereConditions)
				.getOne();

			if (!user) {
				this.logger.warn(
					`User ${searchParameter} not found with applied filters (orgId: ${orgId}, branchId: ${branchId})`,
				);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Cache the user data
			await this.cacheManager.set(cacheKey, user, this.CACHE_TTL);

			const executionTime = Date.now() - startTime;
			this.logger.log(`User ${searchParameter} (${user.email}) retrieved from database in ${executionTime}ms`);

			return {
				user: await this.excludePasswordAndPopulateClients(user),
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to find user ${searchParameter} after ${executionTime}ms. Error: ${error.message}`,
			);

			return {
				user: null,
				message: error?.message,
			};
		}
	}

	/**
	 * Find user by email address
	 * @param email - Email address to search for
	 * @returns User data without password or null with message
	 */
	async findOneByEmail(email: string): Promise<{ user: Omit<User, 'password'> | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`Finding user by email: ${email}`);

		try {
			const user = await this.userRepository.findOne({ where: { email } });

			if (!user) {
				this.logger.warn(`User not found with email: ${email}`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`User found by email: ${email} (${user.uid}) in ${executionTime}ms`);

			const response = {
				user: this.excludePassword(user),
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to find user by email: ${email} after ${executionTime}ms. Error: ${error.message}`,
			);

			const response = {
				message: error?.message,
				user: null,
			};

			return response;
		}
	}

	/**
	 * Find user for authentication purposes (includes password)
	 * Only returns active users for security
	 * @param searchParameter - Username to search for
	 * @returns User with password for authentication or null
	 */
	async findOneForAuth(searchParameter: string): Promise<{ user: User | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`Finding user for authentication: ${searchParameter}`);

		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.rewards', 'rewards')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('user.status = :status', { status: AccountStatus.ACTIVE })
				.andWhere('(user.username = :searchParameter OR user.email = :searchParameter)', { searchParameter })
				.getOne();

			if (!user) {
				const executionTime = Date.now() - startTime;
				this.logger.warn(
					`Authentication attempt failed - user not found: ${searchParameter} (${executionTime}ms)`,
				);
				return {
					user: null,
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`User found for authentication: ${user.email} in ${executionTime}ms`);

			return {
				user,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to find user for authentication: ${searchParameter} after ${executionTime}ms. Error: ${error.message}`,
			);

			const response = {
				message: error?.message,
				user: null,
			};

			return response;
		}
	}

	/**
	 * Find user by Clerk ID with related data
	 * @param clerkUserId - Clerk user ID to search for
	 * @returns User data without password or null with message
	 */
	async findOneByClerkId(clerkUserId: string): Promise<{ user: Omit<User, 'password'> | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`Finding user by Clerk ID: ${clerkUserId}`);

		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.rewards', 'rewards')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.clerkUserId = :clerkUserId', { clerkUserId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				const executionTime = Date.now() - startTime;
				this.logger.warn(`User not found with Clerk ID: ${clerkUserId} (${executionTime}ms)`);
				return {
					user: null,
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`User found by Clerk ID: ${clerkUserId} (${user.email}) in ${executionTime}ms`);

			return {
				user: await this.excludePasswordAndPopulateClients(user),
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to find user by Clerk ID: ${clerkUserId} after ${executionTime}ms. Error: ${error.message}`,
			);

			const response = {
				message: error?.message,
				user: null,
			};

			return response;
		}
	}

	/**
	 * Find user by UID with related data (deprecated - use findOneByClerkId)
	 * @param searchParameter - User UID to search for
	 * @returns User data without password or null with message
	 * @deprecated Use findOneByClerkId instead
	 */
	async findOneByUid(searchParameter: number): Promise<{ user: Omit<User, 'password'> | null; message: string }> {
		// For backward compatibility, find by uid first, then return using clerkUserId
		const startTime = Date.now();
		this.logger.log(`Finding user by UID (deprecated): ${searchParameter}`);

		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.rewards', 'rewards')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.uid = :searchParameter', { searchParameter })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				const executionTime = Date.now() - startTime;
				this.logger.warn(`User not found with UID: ${searchParameter} (${executionTime}ms)`);
				return {
					user: null,
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`User found by UID: ${searchParameter} (${user.email}) in ${executionTime}ms`);

			return {
				user: await this.excludePasswordAndPopulateClients(user),
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to find user by UID: ${searchParameter} after ${executionTime}ms. Error: ${error.message}`,
			);

			const response = {
				message: error?.message,
				user: null,
			};

			return response;
		}
	}

	/**
	 * Get users by email addresses (for role-based operations)
	 * @param recipients - Array of email addresses to find users for
	 * @returns Array of users without passwords or null with message
	 */
	async getUsersByRole(recipients: string[]): Promise<{ users: Omit<User, 'password'>[] | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`Getting users by role for ${recipients.length} recipients`);

		try {
			const users = await this.userRepository.find({
				where: { email: In(recipients) },
			});

			if (!users) {
				this.logger.warn(`No users found for provided email addresses`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`Found ${users.length} users by role in ${executionTime}ms`);

			return {
				users: users.map((user) => this.excludePassword(user)),
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Failed to get users by role after ${executionTime}ms. Error: ${error.message}`);

			const response = {
				message: error?.message,
				users: null,
			};

			return response;
		}
	}

	/**
	 * Find all active admin users in the system
	 * @returns Array of admin users without passwords or null with message
	 */
	async findAdminUsers(): Promise<{ users: Omit<User, 'password'>[] | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`Finding all admin users`);

		try {
			const users = await this.userRepository.find({
				where: {
					accessLevel: AccessLevel.ADMIN,
					isDeleted: false,
					status: AccountStatus.ACTIVE,
				},
			});

			if (!users || users.length === 0) {
				const executionTime = Date.now() - startTime;
				this.logger.warn(`No admin users found in ${executionTime}ms`);
				return {
					users: null,
					message: 'No admin users found',
				};
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`Found ${users.length} admin users in ${executionTime}ms`);

			return {
				users: users.map((user) => this.excludePassword(user)),
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Failed to find admin users after ${executionTime}ms. Error: ${error.message}`);

			return {
				message: error?.message,
				users: null,
			};
		}
	}

	/**
	 * Update user information with optional organization and branch scoping
	 * Includes password hashing and comprehensive cache invalidation
	 * @param ref - User ID to update
	 * @param updateUserDto - Updated user data
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Success message or error details
	 */
	async update(
		ref: number,
		updateUserDto: UpdateUserDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(
			`[USER_UPDATE] Starting user update process for user ID: ${ref} ${orgId ? `in org: ${orgId}` : ''} ${
				branchId ? `in branch: ${branchId}` : ''
			}`,
		);

		try {
			const existingUser = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.uid = :ref', { ref })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!existingUser) {
				throw new NotFoundException('User not found');
			}

			// Track what's being changed for notifications
			const changes = {
				role: false,
				status: false,
				profile: false,
				assignedClients: false,
			};

			// Store original assigned clients for comparison
			const originalAssignedClients = existingUser.assignedClientIds || [];
			let updatedAssignedClients: number[] = [];

			// Note: Password is managed by Clerk, not updated here

			// Check for role/access level change
			if (updateUserDto.accessLevel && updateUserDto.accessLevel !== existingUser.accessLevel) {
				this.logger.log(
					`[USER_UPDATE] Role change detected: ${existingUser.accessLevel} → ${updateUserDto.accessLevel} for user: ${existingUser.email}`,
				);
				changes.role = true;
			}

			// Check for status change
			if (updateUserDto.status && updateUserDto.status !== existingUser.status) {
				this.logger.log(
					`[USER_UPDATE] Status change detected: ${existingUser.status} → ${updateUserDto.status} for user: ${existingUser.email}`,
				);
				changes.status = true;
			}

			// Check for profile changes
			if (updateUserDto.name || updateUserDto.surname || updateUserDto.email || updateUserDto.phone) {
				changes.profile = true;
			}

			// Check for assigned clients changes
			if (updateUserDto.assignedClientIds !== undefined) {
				updatedAssignedClients = updateUserDto.assignedClientIds;
				const originalSet = new Set(originalAssignedClients);
				const updatedSet = new Set(updatedAssignedClients);

				// Check if there are any differences
				const hasChanges =
					originalSet.size !== updatedSet.size ||
					[...originalSet].some((id) => !updatedSet.has(id)) ||
					[...updatedSet].some((id) => !originalSet.has(id));

				if (hasChanges) {
					this.logger.log(
						`[USER_UPDATE] Assigned clients change detected for user: ${
							existingUser.email
						}. Original: [${originalAssignedClients.join(', ')}], Updated: [${updatedAssignedClients.join(
							', ',
						)}]`,
					);
					changes.assignedClients = true;
				}
			}

			// Validate managedDoors if provided
			if (updateUserDto.managedDoors !== undefined) {
				await this.validateManagedDoors(updateUserDto.managedDoors, existingUser.organisationRef || orgId?.toString());
			}

			// Passwords are managed by Clerk only — never stored or updated via DB
			await this.userRepository.update({ uid: ref }, updateUserDto);

			const updatedUser = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.uid = :ref', { ref })
				.getOne();

			if (!updatedUser) {
				throw new NotFoundException('User not found after update');
			}

			this.logger.log(`[USER_UPDATE] User updated successfully: ${updatedUser.uid} (${updatedUser.email})`);

			// Sync profile changes to Clerk after successful database update
			if (existingUser.clerkUserId) {
				try {
					// Build Clerk update payload from the original updateUserDto (password managed by Clerk only, not synced here)
					const clerkUpdatePayload: {
						firstName?: string;
						lastName?: string;
						email?: string;
						phoneNumber?: string;
						imageUrl?: string;
					} = {};

					// Map database fields to Clerk fields
					if (updateUserDto.name !== undefined) {
						clerkUpdatePayload.firstName = updateUserDto.name;
					}
					if (updateUserDto.surname !== undefined) {
						clerkUpdatePayload.lastName = updateUserDto.surname;
					}
					if (updateUserDto.email !== undefined) {
						clerkUpdatePayload.email = updateUserDto.email;
					}
					if (updateUserDto.phone !== undefined) {
						clerkUpdatePayload.phoneNumber = updateUserDto.phone;
					}
					if (updateUserDto.photoURL !== undefined) {
						clerkUpdatePayload.imageUrl = updateUserDto.photoURL;
					}

					// Only call Clerk update if there are fields to sync
					if (Object.keys(clerkUpdatePayload).length > 0) {
						this.logger.log(`[USER_UPDATE] Syncing profile changes to Clerk for user: ${existingUser.clerkUserId}`);
						const clerkSyncSuccess = await this.clerkService.updateClerkUserProfile(
							existingUser.clerkUserId,
							clerkUpdatePayload,
						);

						if (clerkSyncSuccess) {
							// Update sync timestamp in database
							updatedUser.clerkLastSyncedAt = new Date();
							await this.userRepository.save(updatedUser);
							this.logger.log(`[USER_UPDATE] Clerk profile sync completed successfully`);
						} else {
							this.logger.warn(
								`[USER_UPDATE] Clerk profile sync failed for user ${existingUser.clerkUserId}, but database update succeeded`,
							);
							// Don't throw - database is source of truth, Clerk sync failure is logged
						}
					}
				} catch (clerkError) {
					const errorMessage = clerkError instanceof Error ? clerkError.message : 'Unknown error';
					this.logger.error(
						`[USER_UPDATE] Error syncing to Clerk for user ${existingUser.clerkUserId}: ${errorMessage}`,
						clerkError instanceof Error ? clerkError.stack : undefined,
					);
					// Don't throw - database update succeeded, Clerk sync failure is logged
				}
			} else {
				this.logger.debug(`[USER_UPDATE] User ${ref} has no clerkUserId - skipping Clerk sync`);
			}

			// Invalidate cache after update
			await this.invalidateUserCache(updatedUser);

			// Send appropriate notification emails based on what changed
			const emailPromises = [];

			// Determine if we should send a comprehensive update email or individual emails
			const hasMultipleChanges = Object.values(changes).filter(Boolean).length > 1;
			const hasSignificantChanges = changes.assignedClients || changes.role || changes.status;

			if (hasSignificantChanges || hasMultipleChanges) {
				// Send comprehensive user update email
				emailPromises.push(
					this.sendComprehensiveUserUpdateEmail(
						updatedUser,
						existingUser,
						changes,
						originalAssignedClients,
						updatedAssignedClients,
					),
				);
			} else {
				// Send individual emails for single changes
				if (changes.profile) {
					emailPromises.push(this.sendProfileUpdateNotificationEmail(updatedUser));
				}
			}

			// Send push notifications for significant changes
			try {
				// Note: Password changes are managed by Clerk, not handled here
				if (false) { // Password change notifications removed
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.USER_PASSWORD_RESET,
						[updatedUser.uid],
						{
							userName: `${updatedUser.name} ${updatedUser.surname || ''}`.trim(),
						},
						{
							priority: NotificationPriority.HIGH,
						},
					);
				}

				if (changes.role) {
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.USER_ROLE_CHANGED,
						[updatedUser.uid],
						{
							userName: `${updatedUser.name} ${updatedUser.surname || ''}`.trim(),
							newRole: updatedUser.accessLevel,
							previousRole: existingUser.accessLevel,
						},
						{
							priority: NotificationPriority.HIGH,
						},
					);
				}

				if (changes.status) {
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.USER_STATUS_CHANGED,
						[updatedUser.uid],
						{
							userName: `${updatedUser.name} ${updatedUser.surname || ''}`.trim(),
							newStatus: updatedUser.status,
							previousStatus: existingUser.status,
						},
						{
							priority: NotificationPriority.HIGH,
						},
					);
				}

				if (changes.profile || (hasMultipleChanges && !changes.role && !changes.status)) {
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.USER_UPDATED,
						[updatedUser.uid],
						{
							userName: `${updatedUser.name} ${updatedUser.surname || ''}`.trim(),
							updatedBy: 'System Administrator',
						},
						{
							priority: NotificationPriority.NORMAL,
						},
					);
				}
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send user update push notification to ${updatedUser.uid}:`,
					notificationError.message,
				);
			}

			// Send all notification emails in parallel
			if (emailPromises.length > 0) {
				await Promise.all(emailPromises);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`[USER_UPDATE] User update completed successfully in ${executionTime}ms for user: ${updatedUser.email}`,
			);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[USER_UPDATE] Failed to update user ID: ${ref} after ${executionTime}ms. Error: ${error.message}`,
				error.stack,
			);

			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Soft delete a user by marking as deleted and inactive
	 * Includes organization and branch scoping for security
	 * @param ref - User ID to delete
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Success message or error details
	 */
	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(
			`Removing user: ${ref} ${orgId ? `in org: ${orgId}` : ''} ${branchId ? `in branch: ${branchId}` : ''}`,
		);

		try {
			// Build where conditions
			const whereConditions: any = {
				uid: ref,
				isDeleted: false,
			};

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Add branch filter if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			this.logger.debug(`Finding user ${ref} for deletion with scope conditions`);
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where(whereConditions)
				.getOne();

			if (!user) {
				this.logger.warn(`User ${ref} not found for deletion`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.debug(`Soft deleting user: ${user.email} (${ref})`);
			await this.userRepository.update(ref, {
				isDeleted: true,
				status: AccountStatus.INACTIVE,
			});

			// Invalidate cache
			await this.invalidateUserCache(user);

			const executionTime = Date.now() - startTime;
			this.logger.log(`User ${ref} (${user.email}) soft deleted successfully in ${executionTime}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Failed to remove user ${ref} after ${executionTime}ms. Error: ${error.message}`);

			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Create a pending user account that requires verification
	 * @param userData - New user signup data
	 */
	async createPendingUser(userData: NewSignUp): Promise<void> {
		const startTime = Date.now();
		this.logger.log(`Creating pending user: ${userData.email}`);

		try {
			// Note: Password is managed by Clerk, not stored here

			const user = await this.userRepository.save({
				...userData,
				status: userData?.status as AccountStatus,
			});

			// Invalidate cache after creating pending user
			await this.invalidateUserCache(user);

			this.schedulePendingUserCleanup(userData?.email, userData?.tokenExpires);

			const executionTime = Date.now() - startTime;
			this.logger.log(`Pending user created successfully: ${userData.email} (${user.uid}) in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to create pending user: ${userData.email} after ${executionTime}ms. Error: ${error.message}`,
			);
			throw new Error(error?.message);
		}
	}

	/**
	 * Schedule automatic cleanup of pending user accounts that expire
	 * @param email - Email of pending user to cleanup
	 * @param expiryDate - Date when the pending user should be cleaned up
	 */
	private schedulePendingUserCleanup(email: string, expiryDate: Date): void {
		const timeUntilExpiry = expiryDate.getTime() - Date.now();

		setTimeout(async () => {

			try {
				const user = await this.userRepository.findOne({ where: { email } });

				if (user && user?.status === 'pending') {
					this.logger.log(`Cleaning up expired pending user: ${email} (${user.uid})`);
					await this.userRepository.update({ email }, { isDeleted: true });
					this.logger.log(`Expired pending user cleaned up successfully: ${email}`);
				} else {
				}
			} catch (error) {
				this.logger.error(`Error during scheduled cleanup for pending user ${email}:`, error.message);
			}
		}, timeUntilExpiry);
	}

	/**
	 * Restore a soft-deleted user account
	 * @param ref - User ID to restore
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Success message or error details
	 */
	async restore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(
			`Restoring user: ${ref} ${orgId ? `in org: ${orgId}` : ''} ${branchId ? `in branch: ${branchId}` : ''}`,
		);

		try {
			// Build where conditions for deleted users
			const whereConditions: any = {
				uid: ref,
				isDeleted: true, // Looking for deleted users to restore
			};

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Add branch filter if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.withDeleted()
				.where(whereConditions)
				.getOne();

			if (!user) {
				this.logger.warn(`Deleted user ${ref} not found for restoration`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.debug(`Restoring user: ${user.email} (${ref})`);
			await this.userRepository.update(ref, {
				isDeleted: false,
				status: AccountStatus.INACTIVE, // Set to inactive initially
			});

			// Invalidate cache
			await this.invalidateUserCache(user);

			const executionTime = Date.now() - startTime;
			this.logger.log(`User ${ref} (${user.email}) restored successfully in ${executionTime}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Failed to restore user ${ref} after ${executionTime}ms. Error: ${error.message}`);

			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Find user by verification token
	 * @param token - Verification token to search for
	 * @returns User entity or null
	 */
	async findByVerificationToken(token: string): Promise<User | null> {
		const startTime = Date.now();
		this.logger.log(`Finding user by verification token`);

		try {
			const user = await this.userRepository.findOne({
				where: { verificationToken: token, isDeleted: false },
			});

			const executionTime = Date.now() - startTime;
			if (user) {
				this.logger.log(`User found by verification token: ${user.email} (${user.uid}) in ${executionTime}ms`);
			} else {
				this.logger.warn(`No user found with verification token in ${executionTime}ms`);
			}

			return user;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to find user by verification token after ${executionTime}ms. Error: ${error.message}`,
			);
			return null;
		}
	}

	/**
	 * Mark user email as verified and activate account
	 * @param uid - User ID to verify
	 */
	async markEmailAsVerified(uid: number): Promise<void> {
		const startTime = Date.now();
		this.logger.log(`Marking email as verified for user: ${uid}`);

		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :uid', { uid })
				.getOne();

			if (user) {
				this.logger.debug(`Activating user account: ${user.email} (${uid})`);
				await this.userRepository.update(
					{ uid },
					{
						status: AccountStatus.ACTIVE,
						verificationToken: null,
						tokenExpires: null,
					},
				);

				// Invalidate cache after email verification
				await this.invalidateUserCache(user);

				const executionTime = Date.now() - startTime;
				this.logger.log(`Email verified and account activated for user: ${user.email} in ${executionTime}ms`);
			} else {
				this.logger.warn(`User ${uid} not found for email verification`);
			}
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to mark email as verified for user ${uid} after ${executionTime}ms. Error: ${error.message}`,
			);
			throw error;
		}
	}

	/**
	 * Set password for user (typically during account setup)
	 * @deprecated Password is now managed by Clerk, not stored in database
	 * @param uid - User ID
	 * @param password - New password to set
	 */
	async setPassword(uid: number, password: string): Promise<void> {
		this.logger.warn(`setPassword called for user ${uid} - passwords are now managed by Clerk`);
		throw new Error('Password setting is no longer supported. Passwords are managed by Clerk.');
	}

	/**
	 * Update user password (for existing users)
	 * @deprecated Password is now managed by Clerk, not stored in database
	 * @param uid - User ID
	 * @param password - New password to set
	 */
	async updatePassword(uid: number, password: string): Promise<void> {
		this.logger.warn(`updatePassword called for user ${uid} - passwords are now managed by Clerk`);
		throw new Error('Password updates are no longer supported. Passwords are managed by Clerk.');
	}

	/**
	 * Get user targets for a specific user with caching and access control
	 * @param userId - User ID to get targets for
	 * @param orgId - Optional organization ID for access control
	 * @param branchId - Optional branch ID for access control (null for org-wide access)
	 * @returns User target data or null with message
	 */
	async getUserTarget(
		userId: string,
		orgId?: string | number,
		branchId?: number,
	): Promise<{ userTarget: any; message: string }> {
		const startTime = Date.now();

		try {
			// Resolve userId to clerkUserId if it's a numeric ID
			// UserTarget relationship uses clerkUserId, so we must always use clerkUserId for queries
			let clerkUserId: string = userId;
			if (!userId.startsWith('user_')) {
				// If userId is numeric, look up the user to get their clerkUserId
				const numericId = parseInt(userId, 10);
				if (!isNaN(numericId)) {
					const userLookup = await this.userRepository.findOne({
						where: { uid: numericId, isDeleted: false },
						select: ['clerkUserId'],
					});
					if (!userLookup) {
						this.logger.warn(`User ${userId} not found when resolving to clerkUserId`);
						throw new NotFoundException(`User with ID ${userId} not found`);
					}
					clerkUserId = userLookup.clerkUserId;
					this.logger.debug(`Resolved numeric userId ${userId} to clerkUserId: ${clerkUserId}`);
				}
			}

			const cacheKey = this.getCacheKey(`target_${clerkUserId}`);
			const cachedTarget = await this.cacheManager.get(cacheKey);

			if (cachedTarget) {
				
				// TEMPORARY: Return zeros for all user-specific data while logic is being revised
				const cachedResponse = cachedTarget as any;
				if (cachedResponse.personalTargets) {
					// Zero out all current values in personal targets
					if (cachedResponse.personalTargets.sales) cachedResponse.personalTargets.sales.current = 0;
					if (cachedResponse.personalTargets.quotations) cachedResponse.personalTargets.quotations.current = 0;
					if (cachedResponse.personalTargets.hours) cachedResponse.personalTargets.hours.current = 0;
					if (cachedResponse.personalTargets.newClients) cachedResponse.personalTargets.newClients.current = 0;
					if (cachedResponse.personalTargets.newLeads) cachedResponse.personalTargets.newLeads.current = 0;
					if (cachedResponse.personalTargets.checkIns) cachedResponse.personalTargets.checkIns.current = 0;
					if (cachedResponse.personalTargets.calls) cachedResponse.personalTargets.calls.current = 0;
					// Update remaining and progress
					if (cachedResponse.personalTargets.sales) {
						cachedResponse.personalTargets.sales.remaining = cachedResponse.personalTargets.sales.target || 0;
						cachedResponse.personalTargets.sales.progress = 0;
					}
					if (cachedResponse.personalTargets.quotations) {
						cachedResponse.personalTargets.quotations.remaining = cachedResponse.personalTargets.quotations.target || 0;
						cachedResponse.personalTargets.quotations.progress = 0;
					}
					if (cachedResponse.personalTargets.hours) {
						cachedResponse.personalTargets.hours.remaining = cachedResponse.personalTargets.hours.target || 0;
						cachedResponse.personalTargets.hours.progress = 0;
					}
					if (cachedResponse.personalTargets.newClients) {
						cachedResponse.personalTargets.newClients.remaining = cachedResponse.personalTargets.newClients.target || 0;
						cachedResponse.personalTargets.newClients.progress = 0;
					}
					if (cachedResponse.personalTargets.newLeads) {
						cachedResponse.personalTargets.newLeads.remaining = cachedResponse.personalTargets.newLeads.target || 0;
						cachedResponse.personalTargets.newLeads.progress = 0;
					}
					if (cachedResponse.personalTargets.checkIns) {
						cachedResponse.personalTargets.checkIns.remaining = cachedResponse.personalTargets.checkIns.target || 0;
						cachedResponse.personalTargets.checkIns.progress = 0;
					}
					if (cachedResponse.personalTargets.calls) {
						cachedResponse.personalTargets.calls.remaining = cachedResponse.personalTargets.calls.target || 0;
						cachedResponse.personalTargets.calls.progress = 0;
					}
					// Preserve cost breakdown and history from cache (don't zero them out)
					// Cost fields and history are already in cache, no need to modify
					// salesRateAnalysis is calculated dynamically, so keep it as-is
				}
				// Zero out managed staff targets
				if (cachedResponse.managedStaff && Array.isArray(cachedResponse.managedStaff)) {
					cachedResponse.managedStaff.forEach((staff: any) => {
						if (staff.targets) {
							if (staff.targets.sales) {
								staff.targets.sales.current = 0;
								staff.targets.sales.remaining = staff.targets.sales.target || 0;
								staff.targets.sales.progress = 0;
							}
							if (staff.targets.quotations) {
								staff.targets.quotations.current = 0;
								staff.targets.quotations.remaining = staff.targets.quotations.target || 0;
								staff.targets.quotations.progress = 0;
							}
							if (staff.targets.hours) {
								staff.targets.hours.current = 0;
								staff.targets.hours.remaining = staff.targets.hours.target || 0;
								staff.targets.hours.progress = 0;
							}
							if (staff.targets.newClients) {
								staff.targets.newClients.current = 0;
								staff.targets.newClients.remaining = staff.targets.newClients.target || 0;
								staff.targets.newClients.progress = 0;
							}
							if (staff.targets.newLeads) {
								staff.targets.newLeads.current = 0;
								staff.targets.newLeads.remaining = staff.targets.newLeads.target || 0;
								staff.targets.newLeads.progress = 0;
							}
							if (staff.targets.checkIns) {
								staff.targets.checkIns.current = 0;
								staff.targets.checkIns.remaining = staff.targets.checkIns.target || 0;
								staff.targets.checkIns.progress = 0;
							}
							if (staff.targets.calls) {
								staff.targets.calls.current = 0;
								staff.targets.calls.remaining = staff.targets.calls.target || 0;
								staff.targets.calls.progress = 0;
							}
							// Zero out cost breakdown
							staff.targets.baseSalary = 0;
							staff.targets.carInstalment = 0;
							staff.targets.carInsurance = 0;
							staff.targets.fuel = 0;
							staff.targets.cellPhoneAllowance = 0;
							staff.targets.carMaintenance = 0;
							staff.targets.cgicCosts = 0;
						}
					});
				}
				
				const executionTime = Date.now() - startTime;
				this.logger.log(`User target retrieved from cache for user: ${clerkUserId} in ${executionTime}ms (zeros applied)`);
				return {
					userTarget: cachedResponse,
					message: process.env.SUCCESS_MESSAGE,
				};
			}

			
			// Always use clerkUserId for queries since UserTarget relationship uses clerkUserId
			const userForDirectQuery = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.where('user.clerkUserId = :clerkUserId', { clerkUserId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();
			
			if (userForDirectQuery?.userTarget) {
				this.logger.debug(`Direct database query completed for user target: ${clerkUserId}`);
			}
			
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoin('user.userTarget', 'userTarget')
				.addSelect(['user.managedStaff', 'user.managedBranches'])
				.addSelect([
					'userTarget.uid',
					'userTarget.targetSalesAmount',
					'userTarget.currentSalesAmount',
					'userTarget.targetQuotationsAmount',
					'userTarget.currentQuotationsAmount',
					'userTarget.currentOrdersAmount',
					'userTarget.targetCurrency',
					'userTarget.targetHoursWorked',
					'userTarget.currentHoursWorked',
					'userTarget.targetNewClients',
					'userTarget.currentNewClients',
					'userTarget.targetNewLeads',
					'userTarget.currentNewLeads',
					'userTarget.targetCheckIns',
					'userTarget.currentCheckIns',
					'userTarget.targetCalls',
					'userTarget.currentCalls',
					'userTarget.targetPeriod',
					'userTarget.periodStartDate',
					'userTarget.periodEndDate',
					'userTarget.createdAt',
					'userTarget.updatedAt',
					'userTarget.history', // Monthly target performance history
					// Cost breakdown fields
					'userTarget.baseSalary',
					'userTarget.carInstalment',
					'userTarget.carInsurance',
					'userTarget.fuel',
					'userTarget.cellPhoneAllowance',
					'userTarget.carMaintenance',
					'userTarget.cgicCosts',
					'userTarget.erpSalesRepCode',
				])
				.where('user.clerkUserId = :clerkUserId AND user.isDeleted = :isDeleted', { clerkUserId, isDeleted: false });

			// Apply access control filters using Clerk org ID
			if (orgId) {
				// orgId can be Clerk org ID (string) or numeric uid
				// Use clerkOrgId for relationship linking (preferred)
				if (typeof orgId === 'string') {
					queryBuilder.andWhere('organisation.clerkOrgId = :orgId', { orgId });
				} else {
					// Fallback to numeric uid for backward compatibility
					queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
				}
			}

			if (branchId !== null && branchId !== undefined) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			} else if (branchId === null) {
			}

			const user = await queryBuilder.getOne();

			if (!user) {
				this.logger.warn(`User ${clerkUserId} not found when getting targets`);
				throw new NotFoundException(`User with ID ${clerkUserId} not found`);
			}

			// Log raw history data from database for debugging and ensure proper parsing
			if (user.userTarget) {
				// Ensure history is properly parsed (transformer should handle this, but add fallback)
				const rawHistory = user.userTarget.history as any;
				if (typeof rawHistory === 'string') {
					try {
						user.userTarget.history = JSON.parse(rawHistory);
					} catch (e) {
						this.logger.error(`Failed to parse history JSON for user ${clerkUserId}:`, e);
						user.userTarget.history = [];
					}
				}
			}

			// Initialize response object - always return data even if user has no targets
			const erpSalesRepCode = user.userTarget?.erpSalesRepCode || null;
			
			// Log ERP sales rep code for debugging
			if (erpSalesRepCode) {
				this.logger.log(`[getUserTarget] ✅ ERP Sales Rep Code found for user ${clerkUserId}: "${erpSalesRepCode}"`);
			} else {
				this.logger.warn(`[getUserTarget] ⚠️  No ERP Sales Rep Code configured for user ${clerkUserId} in user_targets table`);
			}
			
			let response: any = {
				userId: userId,
				hasPersonalTargets: !!user.userTarget,
				managedBranches: [],
				managedStaff: [],
				// Include erpSalesRepCode at top level for easy access
				erpSalesRepCode: erpSalesRepCode,
			};

			// Add personal targets if they exist with enhanced format
			if (user.userTarget) {
				// Calculate working days remaining if periodEndDate exists
				let workingDaysRemaining = undefined;
				if (user.userTarget.periodEndDate) {
					try {
						workingDaysRemaining = await this.calculateWorkingDaysRemaining(
							user.userTarget.periodEndDate,
							user.organisation?.ref
						);
					} catch (error) {
						this.logger.warn(`Failed to calculate working days remaining for user ${userId}: ${error.message}`);
						// Fall back to simple calendar days if working days calculation fails
						workingDaysRemaining = Math.max(
							0,
							Math.ceil(
								(new Date(user.userTarget.periodEndDate).getTime() - new Date().getTime()) /
									(1000 * 60 * 60 * 24),
							),
						);
					}
				}

				// Calculate sales rate analysis
				let salesRateAnalysis = null;
				if (user.userTarget.targetSalesAmount && user.userTarget.currentSalesAmount && 
					user.userTarget.periodStartDate && user.userTarget.periodEndDate) {
					
					try {
						const periodStart = new Date(user.userTarget.periodStartDate);
						const periodEnd = new Date(user.userTarget.periodEndDate);
						const currentDate = new Date();
						
						// ✅ Get organization hours to calculate working days accurately
						let totalWorkingDays = 0;
						let workingDaysElapsed = 0;
						const organizationRef = user.organisation?.ref;
						
						this.logger.log(`[getUserTarget] 📊 Calculating sales rate analysis for user ${clerkUserId}`);
						this.logger.log(`[getUserTarget]   📅 Period: ${periodStart.toISOString().split('T')[0]} → ${periodEnd.toISOString().split('T')[0]}`);
						this.logger.log(`[getUserTarget]   📍 Current Date: ${currentDate.toISOString().split('T')[0]}`);
						this.logger.log(`[getUserTarget]   💰 Sales: R${user.userTarget.currentSalesAmount?.toLocaleString('en-ZA') || 0} / R${user.userTarget.targetSalesAmount?.toLocaleString('en-ZA') || 0} target`);
						this.logger.log(`[getUserTarget]   🏢 Organization: ${organizationRef || 'N/A'}`);
						
						if (organizationRef) {
							try {
								// Try to get organization hours for accurate working days calculation
								const orgHours = await this.organisationHoursService.findDefault(organizationRef);
								if (orgHours) {
									this.logger.log(`[getUserTarget]   ✅ Using organization hours configuration for accurate working days`);
									
									// Calculate total working days using organization schedule
									totalWorkingDays = this.calculateWorkingDaysWithSchedule(periodStart, periodEnd, orgHours);
									
									// Calculate working days elapsed so far
									const elapsedEndDate = new Date(Math.min(currentDate.getTime(), periodEnd.getTime()));
									workingDaysElapsed = this.calculateWorkingDaysWithSchedule(periodStart, elapsedEndDate, orgHours);
									
									this.logger.log(`[getUserTarget]   📆 Working Days: ${workingDaysElapsed} elapsed / ${totalWorkingDays} total (org-hours)`);
								} else {
									this.logger.warn(`[getUserTarget]   ⚠️  Organization hours not found, using simple business days (Mon-Sat)`);
									totalWorkingDays = this.calculateSimpleBusinessDays(periodStart, periodEnd);
									workingDaysElapsed = this.calculateSimpleBusinessDays(
										periodStart, 
										new Date(Math.min(currentDate.getTime(), periodEnd.getTime()))
									);
									this.logger.log(`[getUserTarget]   📆 Working Days: ${workingDaysElapsed} elapsed / ${totalWorkingDays} total (simple)`);
								}
							} catch (error) {
								this.logger.warn(`[getUserTarget]   ⚠️  Error fetching organization hours: ${error.message}`);
								this.logger.warn(`[getUserTarget]   🔄 Falling back to simple business days calculation`);
								totalWorkingDays = this.calculateSimpleBusinessDays(periodStart, periodEnd);
								workingDaysElapsed = this.calculateSimpleBusinessDays(
									periodStart, 
									new Date(Math.min(currentDate.getTime(), periodEnd.getTime()))
								);
								this.logger.log(`[getUserTarget]   📆 Working Days: ${workingDaysElapsed} elapsed / ${totalWorkingDays} total (fallback)`);
							}
						} else {
							this.logger.warn(`[getUserTarget]   ⚠️  No organization reference available, using simple business days`);
							totalWorkingDays = this.calculateSimpleBusinessDays(periodStart, periodEnd);
							workingDaysElapsed = this.calculateSimpleBusinessDays(
								periodStart, 
								new Date(Math.min(currentDate.getTime(), periodEnd.getTime()))
							);
							this.logger.log(`[getUserTarget]   📆 Working Days: ${workingDaysElapsed} elapsed / ${totalWorkingDays} total (no-org)`);
						}
						
						// Calculate actual sales rate based on days elapsed (more accurate)
						const actualSalesRate = workingDaysElapsed > 0 ? 
							Math.round(user.userTarget.currentSalesAmount / workingDaysElapsed) : 0;
						
						// Calculate required sales rate to meet target over the full period
						const requiredSalesRate = totalWorkingDays > 0 ? 
							Math.round(user.userTarget.targetSalesAmount / totalWorkingDays) : 0;
						
						this.logger.log(`[getUserTarget]   📈 Daily Sales Rate Calculation:`);
						this.logger.log(`[getUserTarget]      ✅ Actual Rate: R${actualSalesRate.toLocaleString('en-ZA')}/day (R${user.userTarget.currentSalesAmount?.toLocaleString('en-ZA') || 0} ÷ ${workingDaysElapsed} days)`);
						this.logger.log(`[getUserTarget]      🎯 Required Rate: R${requiredSalesRate.toLocaleString('en-ZA')}/day (R${user.userTarget.targetSalesAmount?.toLocaleString('en-ZA') || 0} ÷ ${totalWorkingDays} days)`);
						
						// Calculate remaining amount 
						const remainingSalesAmount = Math.max(0, user.userTarget.targetSalesAmount - user.userTarget.currentSalesAmount);
						
						// Enhanced analysis based on period status
						const isOverdue = workingDaysRemaining < 0;
						let achievabilityStatus = 'on-track';
						let dailyRateNeeded = requiredSalesRate;
						let projectedFinalAmount = 0;
						
						if (isOverdue) {
							// For overdue targets, analyze what rate would have been needed to succeed
							achievabilityStatus = remainingSalesAmount > 0 ? 'missed' : 'achieved';
							
							if (remainingSalesAmount > 0) {
								// Calculate what daily rate would have been needed to achieve the remaining target
								// in the remaining time that was available when target period ended
								dailyRateNeeded = Math.round(remainingSalesAmount / Math.abs(workingDaysRemaining));
							} else {
								// Target was achieved, show the rate that was actually needed
								dailyRateNeeded = actualSalesRate;
							}
						} else if (workingDaysRemaining > 0) {
							// For active targets, calculate required daily rate for remaining days
							dailyRateNeeded = Math.round(remainingSalesAmount / Math.abs(workingDaysRemaining));
							
							// Project final amount based on current performance
							projectedFinalAmount = user.userTarget.currentSalesAmount + (actualSalesRate * Math.abs(workingDaysRemaining));
							
							// Determine achievability based on projected performance
							const projectedAchievementRate = user.userTarget.targetSalesAmount > 0 ? 
								(projectedFinalAmount / user.userTarget.targetSalesAmount) : 0;
							
							if (projectedAchievementRate >= 0.95) {
								achievabilityStatus = 'achievable';
							} else if (projectedAchievementRate >= 0.80) {
								achievabilityStatus = 'challenging';
							} else {
								achievabilityStatus = 'at-risk';
							}
						} else {
							// Period just ended today
							achievabilityStatus = remainingSalesAmount > 0 ? 'missed' : 'achieved';
							dailyRateNeeded = actualSalesRate;
						}

						salesRateAnalysis = {
							actualSalesRate,
							requiredSalesRate,
							dailyRateNeeded,
							totalWorkingDays,
							workingDaysElapsed,
							remainingSalesAmount,
							achievabilityStatus,
							performanceGap: requiredSalesRate - actualSalesRate,
							projectedFinalAmount: projectedFinalAmount > 0 ? Math.round(projectedFinalAmount) : null,
							isOverdue
						};
						
						this.logger.log(`[getUserTarget]   ✅ Sales Rate Analysis Complete:`);
						this.logger.log(`[getUserTarget]      💵 Daily Rate Needed: R${dailyRateNeeded.toLocaleString('en-ZA')}/day`);
						this.logger.log(`[getUserTarget]      📊 Remaining: R${remainingSalesAmount.toLocaleString('en-ZA')} (${((remainingSalesAmount / user.userTarget.targetSalesAmount) * 100).toFixed(1)}% of target)`);
						this.logger.log(`[getUserTarget]      📈 Status: ${achievabilityStatus.toUpperCase()} ${isOverdue ? '⚠️ OVERDUE' : ''}`);
						if (projectedFinalAmount > 0) {
							this.logger.log(`[getUserTarget]      🔮 Projected Final: R${Math.round(projectedFinalAmount).toLocaleString('en-ZA')} (${((projectedFinalAmount / user.userTarget.targetSalesAmount) * 100).toFixed(1)}% of target)`);
						}
					} catch (error) {
						this.logger.error(`[getUserTarget] ❌ Failed to calculate sales rate analysis for user ${clerkUserId}`);
						this.logger.error(`[getUserTarget]    Error: ${error.message}`);
						this.logger.debug(`[getUserTarget]    Stack: ${error.stack}`);
					}
				}

				// TEMPORARY: Return zeros for all user-specific data while logic is being revised
				response.personalTargets = {
					uid: user.userTarget.uid,
					// Sales targets - returning zeros
					sales: {
						name: 'Sales',
						target: user.userTarget.targetSalesAmount,
						current: 0,
						remaining: user.userTarget.targetSalesAmount || 0,
						progress: 0,
						currency: user.userTarget.targetCurrency
					},
					// Quotations targets - returning zeros
					quotations: {
						name: 'Quotations',
						target: user.userTarget.targetQuotationsAmount,
						current: 0,
						remaining: user.userTarget.targetQuotationsAmount || 0,
						progress: 0,
						currency: user.userTarget.targetCurrency
					},
					// Hours worked targets - returning zeros
					hours: {
						name: 'Hours Worked',
						target: user.userTarget.targetHoursWorked,
						current: 0,
						remaining: user.userTarget.targetHoursWorked || 0,
						progress: 0,
						unit: 'hours'
					},
					// New clients targets - returning zeros
					newClients: {
						name: 'New Clients',
						target: user.userTarget.targetNewClients,
						current: 0,
						remaining: user.userTarget.targetNewClients || 0,
						progress: 0,
						unit: 'clients'
					},
					// New leads targets - returning zeros
					newLeads: {
						name: 'New Leads',
						target: user.userTarget.targetNewLeads,
						current: 0,
						remaining: user.userTarget.targetNewLeads || 0,
						progress: 0,
						unit: 'leads'
					},
					// Check-ins targets - returning zeros
					checkIns: {
						name: 'Check Ins',
						target: user.userTarget.targetCheckIns,
						current: 0,
						remaining: user.userTarget.targetCheckIns || 0,
						progress: 0,
						unit: 'check-ins'
					},
					// Calls targets - returning zeros
					calls: {
						name: 'Calls',
						target: user.userTarget.targetCalls,
						current: 0,
						remaining: user.userTarget.targetCalls || 0,
						progress: 0,
						unit: 'calls'
					},
					// Period information
					targetPeriod: user.userTarget.targetPeriod,
					periodStartDate: user.userTarget.periodStartDate,
					periodEndDate: user.userTarget.periodEndDate,
					workingDaysRemaining: workingDaysRemaining, // New field for working days remaining
					salesRateAnalysis: salesRateAnalysis, // Use calculated analysis instead of null
					targetCurrency: user.userTarget.targetCurrency,
					createdAt: user.userTarget.createdAt,
					updatedAt: user.userTarget.updatedAt,
					// Cost breakdown fields - use actual values from database
					baseSalary: user.userTarget.baseSalary || 0,
					carInstalment: user.userTarget.carInstalment || 0,
					carInsurance: user.userTarget.carInsurance || 0,
					fuel: user.userTarget.fuel || 0,
					cellPhoneAllowance: user.userTarget.cellPhoneAllowance || 0,
					carMaintenance: user.userTarget.carMaintenance || 0,
					cgicCosts: user.userTarget.cgicCosts || 0,
					// History tracking - use actual history from database
					history: user.userTarget.history || [],
					// ERP Sales Rep Code for linking to ERP data
					erpSalesRepCode: user.userTarget.erpSalesRepCode || null,
				};

				// Log history being added to response
				this.logger.debug(`History being added to response for user ${userId}:`);

			}

			// Fetch managed branches with required details
			if(user?.managedBranches?.length) {
				const managedBranchesDetails = await this.branchRepository.find({
					where: {
						uid: In(user.managedBranches),
						isDeleted: false
					},
					select: {
						uid: true,
						name: true,
						address: true,
						contactPerson: true,
						email: true,
						phone: true,
						status: true,
						createdAt: true
					}
				});

				// Get staff count for each branch
				const branchStaffCounts = await Promise.all(
					managedBranchesDetails.map(async (branch) => {
						const staffCount = await this.userRepository.count({
							where: {
								branch: { uid: branch.uid },
								isDeleted: false
							}
						});
						return { branchUid: branch.uid, staffCount };
					})
				);

				response.managedBranches = managedBranchesDetails.map(branch => {
					const staffCountData = branchStaffCounts.find(sc => sc.branchUid === branch.uid);
					return {
					uid: branch.uid,
					name: branch.name,
					address: branch.address,
					contactPerson: branch.contactPerson,
					email: branch.email,
					phone: branch.phone,
					status: branch.status,
						staffCount: staffCountData?.staffCount || 0
					};
				});
			}

			// Fetch managed staff with their targets
			if(user?.managedStaff?.length) {
				
				// First, let's check if these users exist at all (without access control filters)
				const allUsersCheck = await this.userRepository.find({
					where: {
						uid: In(user.managedStaff)
					},
					select: {
						uid: true,
						name: true,
						surname: true,
						email: true,
						isDeleted: true,
						organisationRef: true
					}
				});
				
				// ✅ Reduced logging: Only log count, not full array
				this.logger.debug(`Found ${allUsersCheck.length} users (including deleted)`);

				// ✅ FIX: Use QueryBuilder with proper leftJoinAndSelect to load userTarget relation
				const managedStaffQueryBuilder = this.userRepository
					.createQueryBuilder('user')
					.leftJoinAndSelect('user.userTarget', 'userTarget')
					.leftJoinAndSelect('user.organisation', 'organisation')
					.leftJoinAndSelect('user.branch', 'branch')
					.where('user.uid IN (:...uids)', { uids: user.managedStaff })
					.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

				const managedStaffDetails = await managedStaffQueryBuilder.getMany();

				this.logger.debug(`Found ${managedStaffDetails.length} active managed staff members`);
				if (managedStaffDetails.length < 10 || process.env.NODE_ENV === 'development') {
					this.logger.debug(`Managed staff UIDs: ${managedStaffDetails.map(s => s.uid).join(', ')}`);
				}

				// ✅ FIX: Use ACTUAL current values from userTarget instead of zeros
				const staffWithTargets = managedStaffDetails.map((staff) => {
					// Log raw userTarget data for debugging
					if (staff.userTarget) {
						this.logger.debug(`[getUserTarget] Staff ${staff.uid} (${staff.name} ${staff.surname}):`);
						this.logger.debug(`  - Sales: current=${staff.userTarget.currentSalesAmount || 0}, target=${staff.userTarget.targetSalesAmount || 0}`);
						this.logger.debug(`  - Quotations: current=${staff.userTarget.currentQuotationsAmount || 0}, target=${staff.userTarget.targetQuotationsAmount || 0}`);
					}

					const calculateProgress = (current: number, target: number) => {
						return target && target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
					};

					const calculateRemaining = (current: number, target: number) => {
						return Math.max(0, target - current);
					};

					const staffTargetData = staff.userTarget ? {
						uid: staff.userTarget.uid,
						sales: {
							name: 'Sales',
							target: staff.userTarget.targetSalesAmount || 0,
							current: staff.userTarget.currentSalesAmount || 0,
							remaining: calculateRemaining(staff.userTarget.currentSalesAmount || 0, staff.userTarget.targetSalesAmount || 0),
							progress: calculateProgress(staff.userTarget.currentSalesAmount || 0, staff.userTarget.targetSalesAmount || 0),
							currency: staff.userTarget.targetCurrency
						},
						quotations: {
							name: 'Quotations',
							target: staff.userTarget.targetQuotationsAmount || 0,
							current: staff.userTarget.currentQuotationsAmount || 0,
							remaining: calculateRemaining(staff.userTarget.currentQuotationsAmount || 0, staff.userTarget.targetQuotationsAmount || 0),
							progress: calculateProgress(staff.userTarget.currentQuotationsAmount || 0, staff.userTarget.targetQuotationsAmount || 0),
							currency: staff.userTarget.targetCurrency
						},
						hours: {
							name: 'Hours Worked',
							target: staff.userTarget.targetHoursWorked || 0,
							current: staff.userTarget.currentHoursWorked || 0,
							remaining: calculateRemaining(staff.userTarget.currentHoursWorked || 0, staff.userTarget.targetHoursWorked || 0),
							progress: calculateProgress(staff.userTarget.currentHoursWorked || 0, staff.userTarget.targetHoursWorked || 0),
							unit: 'hours'
						},
						newClients: {
							name: 'New Clients',
							target: staff.userTarget.targetNewClients || 0,
							current: staff.userTarget.currentNewClients || 0,
							remaining: calculateRemaining(staff.userTarget.currentNewClients || 0, staff.userTarget.targetNewClients || 0),
							progress: calculateProgress(staff.userTarget.currentNewClients || 0, staff.userTarget.targetNewClients || 0),
							unit: 'clients'
						},
						newLeads: {
							name: 'New Leads',
							target: staff.userTarget.targetNewLeads || 0,
							current: staff.userTarget.currentNewLeads || 0,
							remaining: calculateRemaining(staff.userTarget.currentNewLeads || 0, staff.userTarget.targetNewLeads || 0),
							progress: calculateProgress(staff.userTarget.currentNewLeads || 0, staff.userTarget.targetNewLeads || 0),
							unit: 'leads'
						},
						checkIns: {
							name: 'Check Ins',
							target: staff.userTarget.targetCheckIns || 0,
							current: staff.userTarget.currentCheckIns || 0,
							remaining: calculateRemaining(staff.userTarget.currentCheckIns || 0, staff.userTarget.targetCheckIns || 0),
							progress: calculateProgress(staff.userTarget.currentCheckIns || 0, staff.userTarget.targetCheckIns || 0),
							unit: 'check-ins'
						},
						calls: {
							name: 'Calls',
							target: staff.userTarget.targetCalls || 0,
							current: staff.userTarget.currentCalls || 0,
							remaining: calculateRemaining(staff.userTarget.currentCalls || 0, staff.userTarget.targetCalls || 0),
							progress: calculateProgress(staff.userTarget.currentCalls || 0, staff.userTarget.targetCalls || 0),
							unit: 'calls'
						},
						targetPeriod: staff.userTarget.targetPeriod,
						periodStartDate: staff.userTarget.periodStartDate,
						periodEndDate: staff.userTarget.periodEndDate,
						targetCurrency: staff.userTarget.targetCurrency,
						baseSalary: staff.userTarget.baseSalary || 0,
						carInstalment: staff.userTarget.carInstalment || 0,
						carInsurance: staff.userTarget.carInsurance || 0,
						fuel: staff.userTarget.fuel || 0,
						cellPhoneAllowance: staff.userTarget.cellPhoneAllowance || 0,
						carMaintenance: staff.userTarget.carMaintenance || 0,
						cgicCosts: staff.userTarget.cgicCosts || 0,
					} : null;

					return {
						uid: staff.uid,
						fullName: `${staff.name} ${staff.surname || ''}`.trim(),
						email: staff.email,
						avatar: staff.avatar || null,
						organisationRef: staff.organisationRef,
						branchName: staff.branch?.name,
						branchUid: staff.branch?.uid,
						hasTargets: !!staff.userTarget,
						targets: staffTargetData,
					};
				});

				// Log final response for debugging
				this.logger.log(`[getUserTarget] Managed staff response for user ${clerkUserId}: ${staffWithTargets.length} members, ${staffWithTargets.filter(s => s.hasTargets).length} with targets`);
				if (staffWithTargets.length > 0 && staffWithTargets[0].targets?.sales) {
					this.logger.debug(`[getUserTarget] Sample: Staff ${staffWithTargets[0].uid} - Sales: ${staffWithTargets[0].targets.sales.current}/${staffWithTargets[0].targets.sales.target} (${staffWithTargets[0].targets.sales.progress}%)`);
				}

				response.managedStaff = staffWithTargets;
			} else {
				this.logger.debug(`User ${clerkUserId} has no managed staff or managedStaff is empty`);
			}

			this.logger.debug(`Caching user target for user: ${clerkUserId}`);
			await this.cacheManager.set(cacheKey, response, this.TARGET_CACHE_TTL);

			const executionTime = Date.now() - startTime;
			this.logger.log(`User target retrieved from database for user: ${clerkUserId} in ${executionTime}ms`);

			return {
				userTarget: response,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to get user target for user ${userId} after ${executionTime}ms. Error: ${error.message}`,
			);

			return {
				userTarget: null,
				message: error?.message || 'Failed to get user target',
			};
		}
	}

	/**
	 * Set targets for a user (create new or update existing) with access control
	 * @param userId - User ID to set targets for
	 * @param createUserTargetDto - Target data to set
	 * @param orgId - Optional organization ID for access control
	 * @param branchId - Optional branch ID for access control (null for org-wide access)
	 * @returns Success message or error details
	 */
	async setUserTarget(
		userId: number,
		createUserTargetDto: CreateUserTargetDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`Setting user target for user: ${userId}`);

		try {

			// Build where conditions for access control
			const whereConditions: any = {
				uid: userId,
				isDeleted: false,
			};

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Add branch filter if provided
			if (branchId !== null && branchId !== undefined) {
				whereConditions.branch = { uid: branchId };
			}

			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			if (branchId !== null && branchId !== undefined) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const user = await queryBuilder.getOne();

			if (!user) {
				this.logger.warn(`User ${userId} not found for target setting or access denied`);
				throw new NotFoundException(`User with ID ${userId} not found or access denied`);
			}

			// If user already has targets, update them
			if (user.userTarget) {
				await this.updateUserTarget(userId, createUserTargetDto, orgId, branchId);

				const executionTime = Date.now() - startTime;
				this.logger.log(`User targets updated for user: ${userId} in ${executionTime}ms`);

				return {
					message: 'User targets updated successfully',
				};
			}

		// Create a new user target
		const userTarget = new UserTarget();

		// Map DTO properties to entity with proper date conversion
		Object.assign(userTarget, {
			...createUserTargetDto,
			periodStartDate: createUserTargetDto.periodStartDate
				? new Date(createUserTargetDto.periodStartDate)
				: undefined,
			periodEndDate: createUserTargetDto.periodEndDate
				? new Date(createUserTargetDto.periodEndDate)
				: undefined,
		});

		// Set recurring defaults if not explicitly provided
		const isRecurring = createUserTargetDto.isRecurring !== undefined 
			? createUserTargetDto.isRecurring 
			: true; // Default to true
		
		const recurringInterval = createUserTargetDto.recurringInterval || 'monthly'; // Default to monthly

		// Handle recurring target configuration
		if (isRecurring) {
			// Set recurring fields
			userTarget.isRecurring = true;
			userTarget.recurringInterval = recurringInterval;
			userTarget.carryForwardUnfulfilled = createUserTargetDto.carryForwardUnfulfilled ?? false;
			userTarget.recurrenceCount = 0;
			
			// Calculate next recurrence date
			const endDate = userTarget.periodEndDate || new Date();
			userTarget.nextRecurrenceDate = this.calculateNextRecurrenceDate(
				endDate,
				recurringInterval
			);
			
		} else {
			// Explicitly set to false if user disabled it
			userTarget.isRecurring = false;
			userTarget.nextRecurrenceDate = null;
		}

			// Save the user target and update the user
			user.userTarget = userTarget;
			await this.userRepository.save(user);

			// Invalidate the cache
			await this.invalidateUserCache(user);
			await this.cacheManager.del(this.getCacheKey(`target_${userId}`));

			// Send target set email notification
			this.logger.log(`📧 [UserService] Sending target set email notification for user: ${userId}`);
			try {
				const emailData = {
					name: `${user.name} ${user.surname}`.trim(),
					userName: `${user.name} ${user.surname}`.trim(),
					userEmail: user.email,
					userId: user.uid,
					targetDetails: {
						targetSalesAmount: createUserTargetDto.targetSalesAmount,
						targetQuotationsAmount: createUserTargetDto.targetQuotationsAmount,
						targetNewLeads: createUserTargetDto.targetNewLeads,
						targetNewClients: createUserTargetDto.targetNewClients,
						targetCheckIns: createUserTargetDto.targetCheckIns,
						targetCalls: createUserTargetDto.targetCalls,
						periodStartDate: createUserTargetDto.periodStartDate
							? new Date(createUserTargetDto.periodStartDate).toISOString().split('T')[0]
							: undefined,
						periodEndDate: createUserTargetDto.periodEndDate
							? new Date(createUserTargetDto.periodEndDate).toISOString().split('T')[0]
							: undefined,
						description: 'Performance targets have been set for your role',
					},
					organizationName: user.organisation?.name || user.branch?.organisation?.name || 'Your Organization',
					branchName: user.branch?.name,
					createdAt: new Date().toISOString(),
					dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
					supportEmail: this.configService.get('SUPPORT_EMAIL') || 'support@loro.africa',
					mobileAppInfo: {
						appStoreUrl: 'https://apps.apple.com/app/loro-crm/id123456789',
						googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.loro.crm',
						appName: 'Loro CRM Mobile',
						features: [
							'Real-time target tracking',
							'Push notifications for achievements',
							'Offline performance monitoring',
							'Interactive progress charts',
						],
					},
				};

				this.eventEmitter.emit('send.email', EmailType.USER_TARGET_SET, [user.email], emailData);
				this.logger.log(`✅ [UserService] Target set email notification queued for user: ${userId}`);
			} catch (emailError) {
				this.logger.error(
					`❌ [UserService] Failed to queue target set email for user ${userId}:`,
					emailError.message,
				);
			}

			// Send push notification for target changes
			try {
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.USER_TARGET_SET,
					[userId],
					{
						message: `New targets have been set for your performance period. Check your dashboard to view your goals and start tracking progress!`,
						userName: `${user.name} ${user.surname}`.trim(),
						targetSalesAmount: createUserTargetDto.targetSalesAmount,
						targetQuotationsAmount: createUserTargetDto.targetQuotationsAmount,
						targetNewLeads: createUserTargetDto.targetNewLeads,
						targetNewClients: createUserTargetDto.targetNewClients,
						targetCheckIns: createUserTargetDto.targetCheckIns,
						targetCalls: createUserTargetDto.targetCalls,
						periodStartDate: createUserTargetDto.periodStartDate
							? new Date(createUserTargetDto.periodStartDate).toISOString().split('T')[0]
							: undefined,
						periodEndDate: createUserTargetDto.periodEndDate
							? new Date(createUserTargetDto.periodEndDate).toISOString().split('T')[0]
							: undefined,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.HIGH,
					},
				);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send target set push notification to user ${userId}:`,
					notificationError.message,
				);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`User targets set successfully for user: ${userId} in ${executionTime}ms`);

			return {
				message: 'User targets set successfully',
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to set user target for user ${userId} after ${executionTime}ms. Error: ${error.message}`,
			);

			return {
				message: error?.message || 'Failed to set user target',
			};
		}
	}

	/**
	 * Update targets for a user
	 * @param userId - User ID to update targets for
	 * @param updateUserTargetDto - Updated target data
	 * @returns Success message or error details
	 */
	async updateUserTarget(
		userId: number,
		updateUserTargetDto: UpdateUserTargetDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`Updating user target for user: ${userId}`);

		try {

			// Build where conditions for access control
			const whereConditions: any = {
				uid: userId,
				isDeleted: false,
			};

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Add branch filter if provided
			if (branchId !== null && branchId !== undefined) {
				whereConditions.branch = { uid: branchId };
			}

			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			if (branchId !== null && branchId !== undefined) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const user = await queryBuilder.getOne();

			if (!user) {
				this.logger.warn(`User ${userId} not found for target update or access denied`);
				throw new NotFoundException(`User with ID ${userId} not found or access denied`);
			}

			if (!user.userTarget) {
				this.logger.warn(`No targets found for user ${userId} to update`);
				throw new NotFoundException(`No targets found for user with ID ${userId}`);
			}


			// Only include defined values from the DTO
			const filteredUpdateDto = Object.fromEntries(
				Object.entries(updateUserTargetDto).filter(([_, value]) => value !== undefined && value !== null),
			);


			// Handle dates separately if they exist
			const updatedUserTarget = {
				...user.userTarget,
				...filteredUpdateDto,
			};

			// Handle date fields if they exist
			if (updateUserTargetDto.periodStartDate) {
				updatedUserTarget.periodStartDate = new Date(updateUserTargetDto.periodStartDate);
			}
			if (updateUserTargetDto.periodEndDate) {
				updatedUserTarget.periodEndDate = new Date(updateUserTargetDto.periodEndDate);
			}

			// Handle recurring configuration updates
			if (updateUserTargetDto.isRecurring !== undefined) {
				updatedUserTarget.isRecurring = updateUserTargetDto.isRecurring;
				
				if (updateUserTargetDto.isRecurring) {
					// Validate interval
					const interval = updateUserTargetDto.recurringInterval || updatedUserTarget.recurringInterval;
					if (!interval) {
						throw new BadRequestException('recurringInterval is required when isRecurring is true');
					}
					
					updatedUserTarget.recurringInterval = interval;
					updatedUserTarget.carryForwardUnfulfilled = 
						updateUserTargetDto.carryForwardUnfulfilled ?? updatedUserTarget.carryForwardUnfulfilled ?? false;
					
					// Recalculate next recurrence date
					const endDate = updatedUserTarget.periodEndDate || new Date();
					updatedUserTarget.nextRecurrenceDate = this.calculateNextRecurrenceDate(endDate, interval);
					
					this.logger.debug(`Updated recurring config: ${interval}, next: ${updatedUserTarget.nextRecurrenceDate}`);
				} else {
					// Recurring disabled - clear related fields
					updatedUserTarget.recurringInterval = null;
					updatedUserTarget.nextRecurrenceDate = null;
				}
			}

			// Handle interval change without isRecurring change
			if (updateUserTargetDto.recurringInterval && updatedUserTarget.isRecurring) {
				updatedUserTarget.recurringInterval = updateUserTargetDto.recurringInterval;
				const endDate = updatedUserTarget.periodEndDate || new Date();
				updatedUserTarget.nextRecurrenceDate = this.calculateNextRecurrenceDate(
					endDate,
					updateUserTargetDto.recurringInterval
				);
			}

			// Handle carry forward toggle
			if (updateUserTargetDto.carryForwardUnfulfilled !== undefined && updatedUserTarget.isRecurring) {
				updatedUserTarget.carryForwardUnfulfilled = updateUserTargetDto.carryForwardUnfulfilled;
			}


			// Update the user target properties
			Object.assign(user.userTarget, updatedUserTarget);

			// Save the updated user (cascade will update the target)
			this.logger.debug(`Saving updated target for user: ${userId}`);
			await this.userRepository.save(user);

			// Invalidate the cache
			await this.invalidateUserCache(user);
			await this.cacheManager.del(this.getCacheKey(`target_${userId}`));

			// Send target updated email notification
			this.logger.log(`📧 [UserService] Sending target updated email notification for user: ${userId}`);
			try {
				const emailData = {
					name: `${user.name} ${user.surname}`.trim(),
					userName: `${user.name} ${user.surname}`.trim(),
					userEmail: user.email,
					userId: user.uid,
					targetDetails: {
						targetSalesAmount: updatedUserTarget.targetSalesAmount,
						targetQuotationsAmount: updatedUserTarget.targetQuotationsAmount,
						targetNewLeads: updatedUserTarget.targetNewLeads,
						targetNewClients: updatedUserTarget.targetNewClients,
						targetCheckIns: updatedUserTarget.targetCheckIns,
						targetCalls: updatedUserTarget.targetCalls,
						periodStartDate: updatedUserTarget.periodStartDate 
							? (typeof updatedUserTarget.periodStartDate === 'string' 
								? updatedUserTarget.periodStartDate 
								: new Date(updatedUserTarget.periodStartDate).toISOString().split('T')[0])
							: undefined,
						periodEndDate: updatedUserTarget.periodEndDate 
							? (typeof updatedUserTarget.periodEndDate === 'string' 
								? updatedUserTarget.periodEndDate 
								: new Date(updatedUserTarget.periodEndDate).toISOString().split('T')[0])
							: undefined,
						description: 'Your performance targets have been updated',
					},
					organizationName: user.organisation?.name || user.branch?.organisation?.name || 'Your Organization',
					branchName: user.branch?.name,
					updatedAt: new Date().toISOString(),
					dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
					supportEmail: this.configService.get('SUPPORT_EMAIL') || 'support@loro.africa',
					mobileAppInfo: {
						appStoreUrl: 'https://apps.apple.com/app/loro-crm/id123456789',
						googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.loro.crm',
						appName: 'Loro CRM Mobile',
						features: [
							'Real-time target synchronization',
							'Instant update notifications',
							'Mobile-optimized progress tracking',
							'Offline target viewing',
						],
					},
				};

				this.eventEmitter.emit('send.email', EmailType.USER_TARGET_UPDATED, [user.email], emailData);
				this.logger.log(`✅ [UserService] Target updated email notification queued for user: ${userId}`);
			} catch (emailError) {
				this.logger.error(
					`❌ [UserService] Failed to queue target updated email for user ${userId}:`,
					emailError.message,
				);
			}

			// Send push notification for target updates
			try {
				// Determine which target was updated (prioritize the ones that changed)
				const updatedTargets = [];
				if (updateUserTargetDto.targetSalesAmount !== undefined) {
					updatedTargets.push({ type: 'Sales', value: updateUserTargetDto.targetSalesAmount });
				}
				if (updateUserTargetDto.targetQuotationsAmount !== undefined) {
					updatedTargets.push({ type: 'Quotations', value: updateUserTargetDto.targetQuotationsAmount });
				}
				if (updateUserTargetDto.targetNewLeads !== undefined) {
					updatedTargets.push({ type: 'New Leads', value: updateUserTargetDto.targetNewLeads });
				}
				if (updateUserTargetDto.targetNewClients !== undefined) {
					updatedTargets.push({ type: 'New Clients', value: updateUserTargetDto.targetNewClients });
				}
				if (updateUserTargetDto.targetCheckIns !== undefined) {
					updatedTargets.push({ type: 'Check-ins', value: updateUserTargetDto.targetCheckIns });
				}
				if (updateUserTargetDto.targetCalls !== undefined) {
					updatedTargets.push({ type: 'Calls', value: updateUserTargetDto.targetCalls });
				}

				// Use the first updated target or default to "Performance"
				const primaryTarget = updatedTargets.length > 0 ? updatedTargets[0] : { type: 'Performance', value: 'updated' };

				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.USER_TARGET_UPDATED,
					[userId],
					{
						message: `Your performance targets have been updated. Review the changes and adjust your strategy accordingly!`,
						userName: `${user.name} ${user.surname}`.trim(),
						targetType: primaryTarget.type,
						newTargetValue: String(primaryTarget.value),
						targetSalesAmount: updateUserTargetDto.targetSalesAmount,
						targetQuotationsAmount: updateUserTargetDto.targetQuotationsAmount,
						targetNewLeads: updateUserTargetDto.targetNewLeads,
						targetNewClients: updateUserTargetDto.targetNewClients,
						targetCheckIns: updateUserTargetDto.targetCheckIns,
						targetCalls: updateUserTargetDto.targetCalls,
						periodStartDate: updateUserTargetDto.periodStartDate
							? new Date(updateUserTargetDto.periodStartDate).toISOString().split('T')[0]
							: undefined,
						periodEndDate: updateUserTargetDto.periodEndDate
							? new Date(updateUserTargetDto.periodEndDate).toISOString().split('T')[0]
							: undefined,
						updateDate: new Date().toISOString().split('T')[0],
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.HIGH,
					},
				);
				this.logger.debug(`Target update push notification sent to user: ${userId}`);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send target update push notification to user ${userId}:`,
					notificationError.message,
				);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`User targets updated successfully for user: ${userId} in ${executionTime}ms`);

			return {
				message: 'User targets updated successfully',
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to update user target for user ${userId} after ${executionTime}ms. Error: ${error.message}`,
			);

			return {
				message: error?.message || 'Failed to update user target',
			};
		}
	}

	/**
	 * Delete targets for a user with access control
	 * @param userId - User ID to delete targets for
	 * @param orgId - Optional organization ID for access control
	 * @param branchId - Optional branch ID for access control (null for org-wide access)
	 * @returns Success message or error details
	 */
	async deleteUserTarget(userId: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`Deleting user target for user: ${userId}`);

		try {

			// Build where conditions for access control
			const whereConditions: any = {
				uid: userId,
				isDeleted: false,
			};

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Add branch filter if provided
			if (branchId !== null && branchId !== undefined) {
				whereConditions.branch = { uid: branchId };
			}

			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			if (branchId !== null && branchId !== undefined) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const user = await queryBuilder.getOne();

			if (!user) {
				this.logger.warn(`User ${userId} not found for target deletion or access denied`);
				throw new NotFoundException(`User with ID ${userId} not found or access denied`);
			}

			if (!user.userTarget) {
				const executionTime = Date.now() - startTime;
				this.logger.log(`No targets exist for user ${userId} to delete (${executionTime}ms)`);
				return {
					message: 'No targets exist for this user',
				};
			}

			// Set the target to null
			user.userTarget = null;
			await this.userRepository.save(user);

			// Invalidate the cache
			await this.invalidateUserCache(user);
			await this.cacheManager.del(this.getCacheKey(`target_${userId}`));

			// Send target deleted email notification
			this.logger.log(`📧 [UserService] Sending target deleted email notification for user: ${userId}`);
			try {
				const emailData = {
					name: `${user.name} ${user.surname}`.trim(),
					userName: `${user.name} ${user.surname}`.trim(),
					userEmail: user.email,
					targetType: 'User Performance Target',
					reason: 'Target period ended or administrative decision',
					organizationName: user.organisation?.name || user.branch?.organisation?.name || 'Your Organization',
					branchName: user.branch?.name,
					deletedAt: new Date().toISOString(),
					dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
					supportEmail: this.configService.get('SUPPORT_EMAIL') || 'support@loro.africa',
				};

				this.eventEmitter.emit('send.email', EmailType.USER_TARGET_DELETED, [user.email], emailData);
				this.logger.log(`✅ [UserService] Target deleted email notification queued for user: ${userId}`);
			} catch (emailError) {
				this.logger.error(
					`❌ [UserService] Failed to queue target deleted email for user ${userId}:`,
					emailError.message,
				);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`User targets deleted successfully for user: ${userId} in ${executionTime}ms`);

			return {
				message: 'User targets deleted successfully',
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to delete user target for user ${userId} after ${executionTime}ms. Error: ${error.message}`,
			);

			return {
				message: error?.message || 'Failed to delete user target',
			};
		}
	}

	/**
	 * Calculates the user's target progress based on related entities.
	 * Triggered by 'user.target.update.required' event.
	 * Enhanced with atomic race condition protection, data integrity checks, and detailed debugging.
	 * @param payload - Event payload with userId
	 */
	@OnEvent('user.target.update.required')
	async calculateUserTargets(payload: { userId: number }): Promise<void> {
		const { userId } = payload;

		// Atomic race condition protection using promises
		if (this.activeCalculations.has(userId)) {
			await this.activeCalculations.get(userId);
			return;
		}

		// Create calculation promise and mark as active atomically
		const calculationPromise = this.performCalculation(userId);
		this.activeCalculations.set(userId, calculationPromise);

		try {
			await calculationPromise;
		} finally {
			// Always remove user from active calculations
			this.activeCalculations.delete(userId);
		}
	}

	/**
	 * Performs the actual target calculation with enhanced debugging and validation
	 */
	private async performCalculation(userId: number): Promise<void> {
		const startTime = Date.now();
		const calculationId = `CALC_${userId}_${startTime}`;
		
		this.logger.log(`[${calculationId}] Starting target calculation for user: ${userId}`);

		try {
			// Load user and target data
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.warn(`[${calculationId}] User ${userId} not found for target calculation`);
				return;
			}

			if (!user.userTarget) {
				this.logger.debug(`[${calculationId}] No target set for user ${userId}, skipping calculation`);
				return;
			}

			const { userTarget } = user;

			if (!userTarget.periodStartDate || !userTarget.periodEndDate) {
				this.logger.warn(`[${calculationId}] User ${userId} has incomplete target period dates, skipping calculation`);
				return;
			}

			// AUDIT HISTORICAL DATA
			this.logger.log(`[${calculationId}] HISTORICAL DATA AUDIT for user ${userId}:`);
			this.logger.log(`[${calculationId}] Current values - Quotations: ${userTarget.currentQuotationsAmount}, Orders: ${userTarget.currentOrdersAmount}, Sales: ${userTarget.currentSalesAmount}`);
			this.logger.log(`[${calculationId}] Current values - Leads: ${userTarget.currentNewLeads}, Clients: ${userTarget.currentNewClients}, CheckIns: ${userTarget.currentCheckIns}`);
			this.logger.log(`[${calculationId}] Period: ${userTarget.periodStartDate} to ${userTarget.periodEndDate}`);
			this.logger.log(`[${calculationId}] Last calculated: ${(userTarget as any).lastCalculatedAt || 'NEVER'}`);

			// DATA INTEGRITY CHECKS
			const integrityIssues = this.validateExistingData(userTarget, calculationId);
			if (integrityIssues.length > 0) {
				this.logger.warn(`[${calculationId}] Data integrity issues detected: ${integrityIssues.join(', ')}`);
			}

			// Store previous values to check for achievements
			const previousTargetValues = {
				currentQuotationsAmount: userTarget.currentQuotationsAmount,
				currentOrdersAmount: userTarget.currentOrdersAmount,
				currentSalesAmount: userTarget.currentSalesAmount,
				currentNewLeads: userTarget.currentNewLeads,
				currentNewClients: userTarget.currentNewClients,
				currentCheckIns: userTarget.currentCheckIns,
			};

			// Determine the calculation start point
			const calculationStartDate = (userTarget as any).lastCalculatedAt || userTarget.periodStartDate;
			const calculationEndDate = new Date();

			this.logger.debug(
				`[${calculationId}] Calculating INCREMENTAL targets for user ${userId} from ${calculationStartDate} to ${calculationEndDate}`,
			);

			// Track if any new records were found
			let hasNewRecords = false;
			let incrementalUpdates: any = {};

			// --- Calculate NEW quotations since last calculation ---
			const quotationStatuses = [
				OrderStatus.DRAFT,
				OrderStatus.PENDING_INTERNAL,
				OrderStatus.PENDING_CLIENT,
				OrderStatus.NEGOTIATION,
				OrderStatus.APPROVED,
				OrderStatus.REJECTED,
				OrderStatus.SOURCING,
				OrderStatus.PACKING,
			];
			const newQuotations = await this.quotationRepository.find({
				where: {
					placedBy: { uid: userId },
					isClientPlaced: false, // Exclude client-placed orders from sales commission
					status: In(quotationStatuses),
					createdAt: Between(calculationStartDate, calculationEndDate),
				},
			});

			// Calculate incremental quotations amount with detailed logging
			const newQuotationsAmount = newQuotations.reduce((sum, q) => {
				const amount = this.safeParseNumber(q.totalAmount);
				return sum + amount;
			}, 0);

			if (newQuotationsAmount > 0) {
				hasNewRecords = true;
				const currentQuotations = this.safeParseNumber(userTarget.currentQuotationsAmount);
				incrementalUpdates.currentQuotationsAmount = currentQuotations + newQuotationsAmount;
			}

			// --- Calculate NEW completed orders since last calculation ---
			const newCompletedQuotations = await this.quotationRepository.find({
				where: {
					placedBy: { uid: userId },
					isClientPlaced: false, // Exclude client-placed orders from sales commission
					status: OrderStatus.COMPLETED,
					createdAt: Between(calculationStartDate, calculationEndDate),
				},
			});

			// Calculate incremental orders amount with detailed logging
			const newOrdersAmount = newCompletedQuotations.reduce((sum, q) => {
				const amount = this.safeParseNumber(q.totalAmount);
				return sum + amount;
			}, 0);

			if (newOrdersAmount > 0) {
				hasNewRecords = true;
				const currentOrders = this.safeParseNumber(userTarget.currentOrdersAmount);
				incrementalUpdates.currentOrdersAmount = currentOrders + newOrdersAmount;
			}

			// --- Calculate NEW leads since last calculation ---
			const newLeadsCount = await this.leadRepository.count({
				where: {
					owner: { uid: userId },
					createdAt: Between(calculationStartDate, calculationEndDate),
				},
			});

			if (newLeadsCount > 0) {
				hasNewRecords = true;
				const currentLeads = this.safeParseNumber(userTarget.currentNewLeads);
				incrementalUpdates.currentNewLeads = currentLeads + newLeadsCount;
			}

			// --- Calculate NEW clients since last calculation ---
			const newClientsCount = await this.clientRepository.count({
				where: {
					assignedSalesRep: { uid: userId },
					createdAt: Between(calculationStartDate, calculationEndDate),
				},
			});

			if (newClientsCount > 0) {
				hasNewRecords = true;
				const currentClients = this.safeParseNumber(userTarget.currentNewClients);
				incrementalUpdates.currentNewClients = currentClients + newClientsCount;
			}

			// --- Calculate NEW check-ins since last calculation ---
			const newCheckInsCount = await this.checkInRepository.count({
				where: {
					owner: { uid: userId },
					checkInTime: Between(calculationStartDate, calculationEndDate),
				},
			});

			if (newCheckInsCount > 0) {
				hasNewRecords = true;
				const currentCheckIns = this.safeParseNumber(userTarget.currentCheckIns);
				incrementalUpdates.currentCheckIns = currentCheckIns + newCheckInsCount;
			}

			// Check if we should skip the update
			if (!hasNewRecords) {
				const hasExistingValues =
					(userTarget.currentSalesAmount || 0) > 0 ||
					(userTarget.currentQuotationsAmount || 0) > 0 ||
					(userTarget.currentOrdersAmount || 0) > 0 ||
					(userTarget.currentNewLeads || 0) > 0 ||
					(userTarget.currentNewClients || 0) > 0 ||
					(userTarget.currentCheckIns || 0) > 0;

				if (hasExistingValues) {
					return;
				} else {
					return;
				}
			}

			// Apply incremental updates only if we have new records
			if (hasNewRecords) {
				this.logger.log(`[${calculationId}] Applying incremental updates for user ${userId}:`);

				// Apply all incremental updates
				Object.assign(userTarget, incrementalUpdates);

				// ENHANCED SALES CALCULATION with detailed debugging
				const quotationsAmount = this.safeParseNumber(userTarget.currentQuotationsAmount);
				const ordersAmount = this.safeParseNumber(userTarget.currentOrdersAmount);
				
				userTarget.currentSalesAmount = quotationsAmount + ordersAmount;

				// Additional validation for sales amount calculation
				if (userTarget.currentSalesAmount !== (quotationsAmount + ordersAmount)) {
					this.logger.error(`[${calculationId}] CRITICAL: Sales amount calculation mismatch! Expected: ${quotationsAmount + ordersAmount}, Got: ${userTarget.currentSalesAmount}`);
				}
			}

			// Update the last calculation timestamp
			(userTarget as any).lastCalculatedAt = calculationEndDate;

			// Enhanced validation with detailed logging
			if (!this.validateCalculatedValues(userTarget)) {
				this.logger.error(`[${calculationId}] VALIDATION FAILED for user ${userId}:`);
				this.logger.error(`[${calculationId}] - Sales amount: ${userTarget.currentSalesAmount}`);
				this.logger.error(`[${calculationId}] - Quotations amount: ${userTarget.currentQuotationsAmount}`);
				this.logger.error(`[${calculationId}] - Orders amount: ${userTarget.currentOrdersAmount}`);
				this.logger.error(`[${calculationId}] SKIPPING SAVE - User-set values preserved`);
				return;
			}

			// Save the updated target (via user cascade)
			await this.userRepository.save(user);

			// Check for target achievements after saving (only if we had updates)
			if (hasNewRecords) {
				await this.checkAndNotifyTargetAchievements(user, userTarget, previousTargetValues);
			}

			// Invalidate the specific target cache
			await this.cacheManager.del(this.getCacheKey(`target_${userId}`));

			const executionTime = Date.now() - startTime;
			if (hasNewRecords) {
				this.logger.log(
					`[${calculationId}] Target calculation completed successfully for user: ${userId} in ${executionTime}ms - incremental updates applied`,
				);
			} else {
				this.logger.log(
					`[${calculationId}] Target calculation completed for user: ${userId} in ${executionTime}ms - no new records to process`,
				);
			}
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[${calculationId}] Failed to calculate user targets for user ${userId} after ${executionTime}ms. Error: ${error.message}`,
				error.stack,
			);
			throw error; // Re-throw to ensure promise rejection
		}
	}

	/**
	 * Validates existing data for integrity issues
	 */
	private validateExistingData(userTarget: any, calculationId: string): string[] {
		const issues: string[] = [];

		// Check for unreasonably large existing values
		if (userTarget.currentSalesAmount > 10000000) {
			issues.push(`Large sales amount: ${userTarget.currentSalesAmount}`);
		}
		if (userTarget.currentQuotationsAmount > 10000000) {
			issues.push(`Large quotations amount: ${userTarget.currentQuotationsAmount}`);
		}
		if (userTarget.currentOrdersAmount > 10000000) {
			issues.push(`Large orders amount: ${userTarget.currentOrdersAmount}`);
		}

		// Check for negative values
		if (userTarget.currentSalesAmount < 0) {
			issues.push(`Negative sales amount: ${userTarget.currentSalesAmount}`);
		}
		if (userTarget.currentQuotationsAmount < 0) {
			issues.push(`Negative quotations amount: ${userTarget.currentQuotationsAmount}`);
		}
		if (userTarget.currentOrdersAmount < 0) {
			issues.push(`Negative orders amount: ${userTarget.currentOrdersAmount}`);
		}

		// Check for inconsistent sales calculation
		const quotationsAmount = this.safeParseNumber(userTarget.currentQuotationsAmount);
		const ordersAmount = this.safeParseNumber(userTarget.currentOrdersAmount);
		const expectedSalesAmount = quotationsAmount + ordersAmount;
		const actualSalesAmount = this.safeParseNumber(userTarget.currentSalesAmount);
		
		if (Math.abs(expectedSalesAmount - actualSalesAmount) > 0.01) {
			issues.push(`Sales calculation mismatch: expected ${expectedSalesAmount}, actual ${actualSalesAmount}`);
		}

		return issues;
	}

	/**
	 * Check for target achievements and send notifications to user and admins
	 */
	private async checkAndNotifyTargetAchievements(
		user: User,
		userTarget: UserTarget,
		previousValues: any,
	): Promise<void> {
		try {
			this.logger.debug(`Checking target achievements for user: ${user.uid}`);

			const achievedTargets = [];
			const currentDate = new Date().toISOString().split('T')[0];

			// Check each target type for achievement
			const targetChecks = [
				{
					type: 'Sales Amount',
					current: userTarget.currentSalesAmount,
					target: userTarget.targetSalesAmount,
					previous: previousValues.currentSalesAmount,
				},
				{
					type: 'Quotations Amount',
					current: userTarget.currentQuotationsAmount,
					target: userTarget.targetQuotationsAmount,
					previous: previousValues.currentQuotationsAmount,
				},
				{
					type: 'New Leads',
					current: userTarget.currentNewLeads,
					target: userTarget.targetNewLeads,
					previous: previousValues.currentNewLeads,
				},
				{
					type: 'New Clients',
					current: userTarget.currentNewClients,
					target: userTarget.targetNewClients,
					previous: previousValues.currentNewClients,
				},
				{
					type: 'Check-ins',
					current: userTarget.currentCheckIns,
					target: userTarget.targetCheckIns,
					previous: previousValues.currentCheckIns,
				},
			];

			// Check for newly achieved targets
			for (const check of targetChecks) {
				if (check.target && check.target > 0) {
					const currentProgress = ((check.current || 0) / check.target) * 100;
					const previousProgress = ((check.previous || 0) / check.target) * 100;

					// Target achieved (100% or more) and wasn't achieved before
					if (currentProgress >= 100 && previousProgress < 100) {
						achievedTargets.push({
							type: check.type,
							currentValue: check.current || 0,
							targetValue: check.target,
							achievementPercentage: Math.round(currentProgress),
						});
					}
				}
			}

			// Send notifications if any targets were achieved
			if (achievedTargets.length > 0) {
				await this.sendTargetAchievementNotifications(user, achievedTargets, userTarget);
			}

			this.logger.debug(
				`Target achievement check completed for user: ${user.uid}, ${achievedTargets.length} targets achieved`,
			);
		} catch (error) {
			this.logger.error(`Error checking target achievements for user ${user.uid}: ${error.message}`);
		}
	}

	/**
	 * Send target achievement notifications to user and admins
	 */
	private async sendTargetAchievementNotifications(
		user: User,
		achievedTargets: any[],
		userTarget: UserTarget,
	): Promise<void> {
		try {
			this.logger.log(`Sending target achievement notifications for user: ${user.uid}`);

			const achievementData = {
				achievementPercentage: 100,
				currentValue: achievedTargets.reduce((sum, target) => sum + target.currentValue, 0),
				targetValue: achievedTargets.reduce((sum, target) => sum + target.targetValue, 0),
				achievementDate: new Date().toLocaleDateString(),
				periodStartDate: formatDateSafely(userTarget.periodStartDate),
				periodEndDate: formatDateSafely(userTarget.periodEndDate),
				motivationalMessage: this.generateMotivationalMessage(achievedTargets),
			};

			// Send congratulations email to user
			for (const target of achievedTargets) {
				await this.sendTargetAchievementEmail(user.uid, target.type, {
					...achievementData,
					currentValue: target.currentValue,
					targetValue: target.targetValue,
					achievementPercentage: target.achievementPercentage,
				});
			}

			// Send notification to organization admins
			await this.sendTargetAchievementAdminNotifications(user, achievedTargets, userTarget);

			this.logger.log(`Target achievement notifications sent for user: ${user.uid}`);
		} catch (error) {
			this.logger.error(`Error sending target achievement notifications for user ${user.uid}: ${error.message}`);
		}
	}

	/**
	 * Send target achievement notifications to organization admins
	 */
	private async sendTargetAchievementAdminNotifications(
		user: User,
		achievedTargets: any[],
		userTarget: UserTarget,
	): Promise<void> {
		try {
			// Get organization admins
			const admins = await this.getOrganizationAdmins(user.organisation?.uid);

			if (admins.length === 0) {
				this.logger.warn(`No admins found for organization: ${user.organisation?.uid}`);
				return;
			}

			const adminEmailData = {
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				organizationName: user.organisation?.name || 'Organization',
				branchName: user.branch?.name || 'N/A',
				achievedTargets: achievedTargets.map((target) => ({
					type: target.type,
					currentValue: target.currentValue,
					targetValue: target.targetValue,
					achievementPercentage: target.achievementPercentage,
				})),
				totalTargetsAchieved: achievedTargets.length,
				periodStartDate: formatDateSafely(userTarget.periodStartDate),
				periodEndDate: formatDateSafely(userTarget.periodEndDate),
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
				recognitionMessage: this.generateRecognitionMessage(user, achievedTargets),
			};

			// Send admin notification emails
			const adminEmails = admins.map((admin) => admin.email);

			this.eventEmitter.emit('send.email', EmailType.USER_TARGET_ACHIEVEMENT_ADMIN, adminEmails, adminEmailData);

			this.logger.log(
				`Target achievement admin notifications sent to ${adminEmails.length} admins for user: ${user.uid}`,
			);
		} catch (error) {
			this.logger.error(`Error sending admin notifications for user ${user.uid}: ${error.message}`);
		}
	}

	/**
	 * Get organization admins for notifications
	 */
	private async getOrganizationAdmins(orgId?: number): Promise<User[]> {
		if (!orgId) {
			return [];
		}

		try {
			const admins = await this.userRepository.find({
				where: {
					organisation: { uid: orgId },
					accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER]),
					isDeleted: false,
					status: AccountStatus.ACTIVE,
				},
				select: ['uid', 'name', 'surname', 'email', 'accessLevel'],
			});

			return admins;
		} catch (error) {
			this.logger.error(`Error fetching organization admins for org ${orgId}: ${error.message}`);
			return [];
		}
	}

	/**
	 * Generate motivational message for target achievement
	 */
	private generateMotivationalMessage(achievedTargets: any[]): string {
		const messages = [
			'Congratulations! Your dedication and hard work have paid off!',
			"Outstanding performance! You've exceeded expectations!",
			'Incredible achievement! Keep up the excellent work!',
			'Well done! Your commitment to excellence shows!',
			"Fantastic results! You're setting a great example!",
		];

		const randomIndex = Math.floor(Math.random() * messages.length);
		return messages[randomIndex];
	}

	/**
	 * Generate recognition message for admins
	 */
	private generateRecognitionMessage(user: User, achievedTargets: any[]): string {
		const userName = `${user.name} ${user.surname}`.trim();
		const targetTypes = achievedTargets.map((t) => t.type).join(', ');

		return `${userName} has demonstrated exceptional performance by achieving their targets in: ${targetTypes}. Consider recognizing their outstanding contribution to the team.`;
	}

	/**
	 * Re-invite all users in the organization/branch to use the Loro platform
	 * @param scope - Scope defining which users to invite (org, branch, etc.)
	 * @returns Statistics about the invitation process
	 */
	async reInviteAllUsers(scope: {
		orgId?: string;
		branchId?: string;
		userId: string;
		userRole?: string;
	}): Promise<{ invitedCount: number; totalUsers: number; excludedCount: number }> {
		const startTime = Date.now();
		this.logger.log(`Re-inviting all users`);

		try {
			this.logger.debug('Building query for eligible users');
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.isDeleted = :isDeleted', { isDeleted: false });

			// Apply organization filter if provided
			if (scope?.orgId) {
				this.logger.debug(`Applying organization filter: ${scope.orgId}`);
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: parseInt(scope.orgId) });
			}

			// Apply branch filter if provided
			if (scope?.branchId) {
				this.logger.debug(`Applying branch filter: ${scope.branchId}`);
				queryBuilder.andWhere('branch.uid = :branchId', { branchId: parseInt(scope.branchId) });
			}

			// Exclude users that shouldn't receive re-invitations
			queryBuilder.andWhere('user.status NOT IN (:...excludedStatuses)', {
				excludedStatuses: [AccountStatus.DELETED, AccountStatus.BANNED, AccountStatus.INACTIVE],
			});

			this.logger.debug('Fetching eligible users for re-invitation');
			const users = await queryBuilder.getMany();
			const totalUsers = users.length;
			let invitedCount = 0;
			let excludedCount = 0;

			this.logger.log(`Found ${totalUsers} eligible users for re-invitation`);

			// Send re-invitation emails to eligible users
			for (const user of users) {
				try {
					this.logger.debug(`Sending re-invitation email to user: ${user.email} (${user.uid})`);
					await this.sendReInvitationEmail(user);
					invitedCount++;
				} catch (error) {
					this.logger.error(`Failed to send re-invitation email to user ${user.uid}:`, error.message);
					excludedCount++;
				}
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`Re-invitation process completed in ${executionTime}ms. Invited: ${invitedCount}, Excluded: ${excludedCount}, Total: ${totalUsers}`,
			);

			return {
				invitedCount,
				totalUsers,
				excludedCount,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Error re-inviting all users after ${executionTime}ms:`, error.message);
			throw error;
		}
	}

	/**
	 * Re-invite a specific user to use the Loro platform
	 * @param userId - ID of user to re-invite
	 * @param scope - Scope defining access permissions
	 * @returns User ID and email of re-invited user
	 */
	async reInviteUser(
		userId: string,
		scope: {
			orgId?: string;
			branchId?: string;
			userId: string;
			userRole?: string;
		},
	): Promise<{ userId: string; email: string }> {
		const startTime = Date.now();
		this.logger.log(`Re-inviting user: ${userId}`);

		try {
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

			// Apply organization filter if provided
			if (scope?.orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: parseInt(scope.orgId) });
			}

			// Apply branch filter if provided
			if (scope?.branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId: parseInt(scope.branchId) });
			}

			const user = await queryBuilder.getOne();

			if (!user) {
				this.logger.warn(`User ${userId} not found for re-invitation`);
				throw new NotFoundException('User not found');
			}

			// Check if user can be re-invited
			if (
				[AccountStatus.DELETED, AccountStatus.BANNED, AccountStatus.INACTIVE].includes(
					user.status as AccountStatus,
				)
			) {
				this.logger.warn(`User ${userId} (${user.email}) cannot be re-invited due to status: ${user.status}`);
				throw new Error('User cannot be re-invited due to account status');
			}

			// Send re-invitation email
			await this.sendReInvitationEmail(user);

			const executionTime = Date.now() - startTime;
			this.logger.log(`User ${userId} (${user.email}) re-invited successfully in ${executionTime}ms`);

			return {
				userId: user.uid.toString(),
				email: user.email,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Error re-inviting user ${userId} after ${executionTime}ms:`, error.message);
			throw error;
		}
	}

	/**
	 * Send re-invitation email to a user
	 * @param user - User to send re-invitation email to
	 */
	private async sendReInvitationEmail(user: User): Promise<void> {
		const startTime = Date.now();

		try {
			// Prepare re-invitation email data
			const reInvitationData = {
				userEmail: user.email,
				userName: `${user.name} ${user.surname}`,
				userFirstName: user.name,
				platformName: 'Loro',
				loginUrl: process.env.FRONTEND_URL || 'https://app.loro.com',
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.com',
				organizationName: user.organisation?.name || 'your organization',
				branchName: user.branch?.name || 'your branch',
			};

			this.logger.debug(`Emitting re-invitation email event for user: ${user.email}`);
			// Emit email event for re-invitation
			this.eventEmitter.emit('send.email', EmailType.USER_RE_INVITATION, [user.email], reInvitationData);

			const executionTime = Date.now() - startTime;
			this.logger.log(`Re-invitation email sent to user: ${user.email} in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Error sending re-invitation email to ${user.email} after ${executionTime}ms:`,
				error.message,
			);
			throw error;
		}
	}

	/**
	 * Send welcome email to newly created user
	 * @param user - User to send welcome email to
	 */
	private async sendWelcomeEmail(user: User): Promise<void> {
		const startTime = Date.now();
		this.logger.debug(`Preparing welcome email for new user: ${user.email} (${user.uid})`);

		try {
			// Get organization and branch names for the email
			const organizationName = user.organisation?.name || process.env.COMPANY_NAME || 'Your Organization';
			const branchName = user.branch?.name || 'Main Branch';

			// Prepare email data
			const emailData: NewUserWelcomeData = {
				name: user.name || user.email,
				email: user.email,
				loginUrl: process.env.WEBSITE_DOMAIN || 'https://dashboard.loro.co.za/sign-in',
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				supportPhone: process.env.SUPPORT_PHONE || '+27 12 345 6789',
				organizationName,
				branchName,
				dashboardUrl: process.env.WEBSITE_DOMAIN || 'https://dashboard.loro.co.za',
			};

			this.logger.debug(`Emitting welcome email event for user: ${user.email}`);
			// Send the welcome email
			this.eventEmitter.emit('send.email', EmailType.NEW_USER_WELCOME, [user.email], emailData);

			const executionTime = Date.now() - startTime;
			this.logger.log(`Welcome email sent to user: ${user.email} in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Error sending welcome email to user ${user.email} after ${executionTime}ms:`,
				error.message,
			);
			// Don't throw the error as user creation should still succeed even if email fails
		}
	}

	/**
	 * Update user targets from external ERP system with concurrency control
	 * Handles concurrent updates using optimistic locking and retry mechanism
	 * @param userId - User ID to update targets for
	 * @param externalUpdate - External update data from ERP system
	 * @param orgId - Organization ID for scoping
	 * @param branchId - Branch ID for scoping
	 * @returns Success message with updated values or conflict details
	 */
	async updateUserTargetsFromERP(
		userId: number,
		externalUpdate: ExternalTargetUpdateDto,
		orgId?: number,
		branchId?: number,
	): Promise<{
		message: string;
		updatedValues?: Partial<UserTarget>;
		conflictDetails?: any;
		validationErrors?: string[];
	}> {
		const startTime = Date.now();

		// 🔧 Handle optional source field
		const sourceSystem = externalUpdate.source || 'UNKNOWN_SOURCE';

		this.logger.log(`🔄 [ERP_UPDATE] Starting ERP target update for user: ${userId}, source: ${sourceSystem}`);

		try {
			// Validate external update data
			this.logger.debug(
				`🔍 [ERP_UPDATE] Starting validation for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
			);
			const validationResult = await this.validateExternalTargetUpdate(userId, externalUpdate, orgId, branchId);

			if (!validationResult.isValid) {
				this.logger.error(
					`❌ [ERP_UPDATE] Validation failed for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
					{
						errors: validationResult.errors,
						updateMode: externalUpdate.updateMode,
						sourceSystem,
						updates: externalUpdate.updates,
					},
				);
				return {
					message: 'Validation failed',
					validationErrors: validationResult.errors,
				};
			}

			this.logger.debug(
				`✅ [ERP_UPDATE] Validation passed for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
			);

			// Implement optimistic locking with retry mechanism
			const maxRetries = 3;
			let retryCount = 0;
			let lastError: any;

			this.logger.debug(
				`🔄 [ERP_UPDATE] Starting retry mechanism (max ${maxRetries} attempts) for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
			);

			while (retryCount < maxRetries) {
				const attemptStartTime = Date.now();
				this.logger.debug(
					`🎯 [ERP_UPDATE] Attempt ${retryCount + 1}/${maxRetries} for user: ${userId}, transaction: ${
						externalUpdate.transactionId
					}`,
				);

				try {
					// Start transaction
					this.logger.debug(
						`🔒 [ERP_UPDATE] Starting database transaction for user: ${userId}, attempt: ${retryCount + 1}`,
					);
					const result = await this.userRepository.manager.transaction(async (transactionalEntityManager) => {
						// Get current user with target and version for optimistic locking
						this.logger.debug(
							`🔍 [ERP_UPDATE] Querying user data with pessimistic lock for user: ${userId}`,
						);
						const user = await transactionalEntityManager
							.createQueryBuilder(User, 'user')
							.leftJoin('user.userTarget', 'userTarget')
							.addSelect([
								'userTarget.uid',
								'userTarget.targetSalesAmount',
								'userTarget.currentSalesAmount',
								'userTarget.targetQuotationsAmount',
								'userTarget.currentQuotationsAmount',
								'userTarget.currentOrdersAmount',
								'userTarget.targetCurrency',
								'userTarget.targetHoursWorked',
								'userTarget.currentHoursWorked',
								'userTarget.targetNewClients',
								'userTarget.currentNewClients',
								'userTarget.targetNewLeads',
								'userTarget.currentNewLeads',
								'userTarget.targetCheckIns',
								'userTarget.currentCheckIns',
								'userTarget.targetCalls',
								'userTarget.currentCalls',
								'userTarget.targetPeriod',
								'userTarget.periodStartDate',
								'userTarget.periodEndDate',
								'userTarget.createdAt',
								'userTarget.updatedAt',
							])
							.leftJoinAndSelect('user.organisation', 'organisation')
							.leftJoinAndSelect('user.branch', 'branch')
							.where('user.uid = :userId', { userId })
							.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
							.andWhere(orgId ? 'organisation.uid = :orgId' : '1=1', { orgId })
							.andWhere(branchId ? 'branch.uid = :branchId' : '1=1', { branchId })
							.setLock('pessimistic_write') // Use pessimistic locking for external updates
							.getOne();

						if (!user) {
							this.logger.error(
								`❌ [ERP_UPDATE] User not found or access denied - User: ${userId}, OrgId: ${orgId}, BranchId: ${branchId}, Transaction: ${externalUpdate.transactionId}`,
							);
							throw new NotFoundException(`User ${userId} not found or access denied`);
						}

						if (!user.userTarget) {
							this.logger.error(
								`❌ [ERP_UPDATE] No targets found for user: ${userId}, Transaction: ${externalUpdate.transactionId}`,
							);
							throw new NotFoundException(`No targets found for user ${userId}`);
						}

						// Calculate new values based on update mode
						this.logger.debug(
							`🧮 [ERP_UPDATE] Calculating target updates for user: ${userId}, mode: ${externalUpdate.updateMode}`,
						);
						const updatedTarget = this.calculateTargetUpdates(user.userTarget, externalUpdate);

						// Update target with new values
						this.logger.debug(
							`💾 [ERP_UPDATE] Updating UserTarget in database for user: ${userId}, target UID: ${user.userTarget.uid}`,
						);
						await transactionalEntityManager.update(
							UserTarget,
							{ uid: user.userTarget.uid },
							{
								...updatedTarget,
								updatedAt: new Date(),
							},
						);
						this.logger.debug(`✅ [ERP_UPDATE] UserTarget updated successfully for user: ${userId}`);

						// Create audit trail
						this.logger.debug(
							`📝 [ERP_UPDATE] Creating audit trail for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
						);
						await this.createTargetUpdateAuditLog(
							transactionalEntityManager,
							userId,
							sourceSystem,
							externalUpdate.transactionId,
							user.userTarget,
							updatedTarget,
						);
						this.logger.debug(`✅ [ERP_UPDATE] Audit trail created for user: ${userId}`);

						return updatedTarget;
					});

					// Get updated user for cache invalidation
					this.logger.debug(`🔄 [ERP_UPDATE] Fetching updated user for cache invalidation, user: ${userId}`);
					const updatedUser = await this.userRepository
						.createQueryBuilder('user')
						.leftJoinAndSelect('user.organisation', 'organisation')
						.leftJoinAndSelect('user.branch', 'branch')
						.where('user.uid = :userId', { userId })
						.getOne();

					if (updatedUser) {
						// Invalidate cache
						this.logger.debug(`🗑️ [ERP_UPDATE] Invalidating cache for user: ${userId}`);
						await this.invalidateUserCache(updatedUser);
						await this.cacheManager.del(this.getCacheKey(`target_${userId}`));
						this.logger.debug(`✅ [ERP_UPDATE] Cache invalidated for user: ${userId}`);
					} else {
						this.logger.warn(
							`⚠️ [ERP_UPDATE] Updated user not found for cache invalidation, user: ${userId}`,
						);
					}

					// Emit success event
					this.logger.debug(
						`📡 [ERP_UPDATE] Emitting success event for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
					);
					this.eventEmitter.emit('user.target.external.update.completed', {
						userId,
						source: sourceSystem,
						transactionId: externalUpdate.transactionId,
						updatedValues: result,
					});

					// Send contribution progress notification if there are increases
					this.logger.debug(
						`📧 [ERP_UPDATE] Attempting to send contribution progress notification for user: ${userId}`,
					);
					try {
						await this.sendContributionProgressNotification(userId, externalUpdate, result);
						this.logger.debug(
							`✅ [ERP_UPDATE] Contribution progress notification sent for user: ${userId}`,
						);
					} catch (notificationError) {
						this.logger.warn(
							`⚠️ [ERP_UPDATE] Failed to send contribution progress notification for user ${userId}: ${notificationError.message}`,
						);
						// Don't fail the update if notification fails
					}

					// Send push notification for target update
					this.logger.debug(`📱 [ERP_UPDATE] Attempting to send push notification for user: ${userId}`);
					try {
						await this.sendTargetUpdatePushNotification(userId, externalUpdate, result);
						this.logger.debug(`✅ [ERP_UPDATE] Push notification sent for user: ${userId}`);
					} catch (pushNotificationError) {
						this.logger.warn(
							`⚠️ [ERP_UPDATE] Failed to send push notification for user ${userId}: ${pushNotificationError.message}`,
						);
						// Don't fail the update if push notification fails
					}

					const attemptTime = Date.now() - attemptStartTime;
					const totalTime = Date.now() - startTime;
					this.logger.log(
						`🎉 [ERP_UPDATE] SUCCESS - ERP target update completed for user ${userId} in ${totalTime}ms (attempt ${
							retryCount + 1
						}/${maxRetries}, attempt time: ${attemptTime}ms)`,
					);

					return {
						message: 'User targets updated successfully from ERP',
						updatedValues: result,
					};
				} catch (error) {
					lastError = error;
					retryCount++;
					const attemptTime = Date.now() - attemptStartTime;

					this.logger.error(
						`❌ [ERP_UPDATE] Attempt ${retryCount}/${maxRetries} failed for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
						{
							error: error.message,
							errorCode: error.code,
							errorType: error.constructor.name,
							attemptTime,
							userId,
							transactionId: externalUpdate.transactionId,
							stackTrace: error.stack,
						},
					);

					if (error.code === 'ER_LOCK_WAIT_TIMEOUT' || error.message.includes('concurrent')) {
						this.logger.warn(
							`🔄 [ERP_UPDATE] Concurrent update conflict for user ${userId}, retry ${retryCount}/${maxRetries}`,
							{
								errorCode: error.code,
								retryCount,
								maxRetries,
								nextBackoffTime: `${Math.pow(2, retryCount) * 100}ms`,
							},
						);

						if (retryCount < maxRetries) {
							// Exponential backoff
							const backoffTime = Math.pow(2, retryCount) * 100;
							this.logger.debug(
								`⏳ [ERP_UPDATE] Backing off for ${backoffTime}ms before retry ${
									retryCount + 1
								} for user: ${userId}`,
							);
							await new Promise((resolve) => setTimeout(resolve, backoffTime));
							continue;
						}
					} else {
						// Non-recoverable error, don't retry
						this.logger.error(
							`💥 [ERP_UPDATE] Non-retryable error for user ${userId}, aborting retries: ${error.message}`,
							{
								errorType: error.constructor.name,
								errorCode: error.code,
								userId,
								transactionId: externalUpdate.transactionId,
							},
						);
						break;
					}
				}
			}

			// All retries failed
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`💀 [ERP_UPDATE] FINAL FAILURE - ERP target update failed for user ${userId} after ${retryCount} attempts in ${executionTime}ms`,
				{
					userId,
					retryCount,
					maxRetries,
					totalExecutionTime: executionTime,
					transactionId: externalUpdate.transactionId,
					lastError: lastError?.message,
					lastErrorCode: lastError?.code,
					lastErrorType: lastError?.constructor?.name,
				},
			);

			// Emit failure event
			this.logger.debug(
				`📡 [ERP_UPDATE] Emitting failure event for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
			);
			this.eventEmitter.emit('user.target.external.update.failed', {
				userId,
				source: sourceSystem,
				transactionId: externalUpdate.transactionId,
				error: lastError.message,
				retryCount,
			});

			if (lastError.code === 'ER_LOCK_WAIT_TIMEOUT' || lastError.message.includes('concurrent')) {
				this.logger.warn(
					`⚠️ [ERP_UPDATE] Returning conflict response due to concurrent update for user: ${userId}`,
					{
						transactionId: externalUpdate.transactionId,
						retryCount,
						error: lastError.message,
					},
				);
				return {
					message: 'Concurrent update conflict detected',
					conflictDetails: {
						retryCount,
						error: lastError.message,
						suggestion: 'Please retry the update after a short delay',
					},
				};
			}

			this.logger.error(`💥 [ERP_UPDATE] Returning error response for user: ${userId}`, {
				error: lastError?.message,
				errorCode: lastError?.code,
				transactionId: externalUpdate.transactionId,
			});
			return {
				message: lastError.message || 'Failed to update user targets from ERP',
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`🚨 [ERP_UPDATE] OUTER CATCH - Unexpected error for user ${userId} after ${executionTime}ms: ${error.message}`,
				{
					userId,
					transactionId: externalUpdate.transactionId,
					executionTime,
					error: error.message,
					errorCode: error.code,
					errorType: error.constructor.name,
					stackTrace: error.stack,
				},
			);

			return {
				message: error.message || 'Failed to update user targets from ERP',
			};
		}
	}

	/**
	 * Calculate target updates based on update mode
	 * @private
	 */
	private calculateTargetUpdates(
		currentTarget: UserTarget,
		externalUpdate: ExternalTargetUpdateDto,
	): Partial<UserTarget> {
		const updates: Partial<UserTarget> = {};

		// Handle different update modes
		if (externalUpdate.updateMode === TargetUpdateMode.INCREMENT) {
			this.logger.debug(
				`📈 [ERP_CALCULATION] Processing INCREMENT mode for transaction: ${externalUpdate.transactionId}`,
			);
			// Add to current values
			if (externalUpdate.updates.currentSalesAmount !== undefined) {
				updates.currentSalesAmount =
					(currentTarget.currentSalesAmount || 0) + externalUpdate.updates.currentSalesAmount;
			}
			if (externalUpdate.updates.currentQuotationsAmount !== undefined) {
				updates.currentQuotationsAmount =
					(currentTarget.currentQuotationsAmount || 0) + externalUpdate.updates.currentQuotationsAmount;
			}
			if (externalUpdate.updates.currentOrdersAmount !== undefined) {
				updates.currentOrdersAmount =
					(currentTarget.currentOrdersAmount || 0) + externalUpdate.updates.currentOrdersAmount;
			}
			if (externalUpdate.updates.currentNewLeads !== undefined) {
				updates.currentNewLeads = (currentTarget.currentNewLeads || 0) + externalUpdate.updates.currentNewLeads;
			}
			if (externalUpdate.updates.currentNewClients !== undefined) {
				updates.currentNewClients =
					(currentTarget.currentNewClients || 0) + externalUpdate.updates.currentNewClients;
			}
			if (externalUpdate.updates.currentCheckIns !== undefined) {
				updates.currentCheckIns = (currentTarget.currentCheckIns || 0) + externalUpdate.updates.currentCheckIns;
			}
			if (externalUpdate.updates.currentHoursWorked !== undefined) {
				updates.currentHoursWorked =
					(currentTarget.currentHoursWorked || 0) + externalUpdate.updates.currentHoursWorked;
			}
			if (externalUpdate.updates.currentCalls !== undefined) {
				updates.currentCalls = (currentTarget.currentCalls || 0) + externalUpdate.updates.currentCalls;
			}
		} else if (externalUpdate.updateMode === TargetUpdateMode.DECREMENT) {
			this.logger.debug(
				`📉 [ERP_CALCULATION] Processing DECREMENT mode for transaction: ${externalUpdate.transactionId}`,
			);
			// Subtract from current values (more explicit than using negative increments)
			if (externalUpdate.updates.currentSalesAmount !== undefined) {
				updates.currentSalesAmount =
					(currentTarget.currentSalesAmount || 0) - externalUpdate.updates.currentSalesAmount;
			}
			if (externalUpdate.updates.currentQuotationsAmount !== undefined) {
				updates.currentQuotationsAmount =
					(currentTarget.currentQuotationsAmount || 0) - externalUpdate.updates.currentQuotationsAmount;
			}
			if (externalUpdate.updates.currentOrdersAmount !== undefined) {
				updates.currentOrdersAmount =
					(currentTarget.currentOrdersAmount || 0) - externalUpdate.updates.currentOrdersAmount;
			}
			if (externalUpdate.updates.currentNewLeads !== undefined) {
				updates.currentNewLeads = (currentTarget.currentNewLeads || 0) - externalUpdate.updates.currentNewLeads;
			}
			if (externalUpdate.updates.currentNewClients !== undefined) {
				updates.currentNewClients =
					(currentTarget.currentNewClients || 0) - externalUpdate.updates.currentNewClients;
			}
			if (externalUpdate.updates.currentCheckIns !== undefined) {
				updates.currentCheckIns = (currentTarget.currentCheckIns || 0) - externalUpdate.updates.currentCheckIns;
			}
			if (externalUpdate.updates.currentHoursWorked !== undefined) {
				updates.currentHoursWorked =
					(currentTarget.currentHoursWorked || 0) - externalUpdate.updates.currentHoursWorked;
			}
			if (externalUpdate.updates.currentCalls !== undefined) {
				updates.currentCalls = (currentTarget.currentCalls || 0) - externalUpdate.updates.currentCalls;
			}
		} else {
			// REPLACE mode - set absolute values
			this.logger.debug(
				`🔄 [ERP_CALCULATION] Processing REPLACE mode for transaction: ${externalUpdate.transactionId}`,
			);
			Object.assign(updates, externalUpdate.updates);
		}

		return updates;
	}

	/**
	 * Validate external target update data
	 * @private
	 */
	private async validateExternalTargetUpdate(
		userId: number,
		externalUpdate: ExternalTargetUpdateDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ isValid: boolean; errors: string[] }> {
		const errors: string[] = [];

		try {
			// Validate user exists and has targets
			this.logger.debug(`👤 [ERP_VALIDATION] Checking user existence for user: ${userId}`);
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const user = await queryBuilder.getOne();

			if (!user) {
				this.logger.error(
					`❌ [ERP_VALIDATION] User not found or access denied - User: ${userId}, OrgId: ${orgId}, BranchId: ${branchId}, Transaction: ${externalUpdate.transactionId}`,
				);
				errors.push(`User ${userId} not found or access denied`);
				return { isValid: false, errors };
			}

			this.logger.debug(
				`✅ [ERP_VALIDATION] User found: ${userId}, Name: ${user.name} ${user.surname}, Email: ${user.email}`,
			);

			if (!user.userTarget) {
				this.logger.error(
					`❌ [ERP_VALIDATION] No targets configured for user: ${userId}, Transaction: ${externalUpdate.transactionId}`,
				);
				errors.push(`No targets found for user ${userId}`);
				return { isValid: false, errors };
			}

			this.logger.debug(
				`✅ [ERP_VALIDATION] User targets found for user: ${userId}, Target UID: ${user.userTarget.uid}`,
			);

			// Validate update modes and values
			this.logger.debug(
				`🔧 [ERP_VALIDATION] Validating update mode: ${externalUpdate.updateMode} for user: ${userId}`,
			);
			if (externalUpdate.updateMode === TargetUpdateMode.INCREMENT) {
				this.logger.debug(
					`📈 [ERP_VALIDATION] Validating INCREMENT mode values for user: ${userId}`,
					externalUpdate.updates,
				);
				// INCREMENT mode: Only accept positive values to add to current amounts
				if (
					externalUpdate.updates.currentSalesAmount !== undefined &&
					externalUpdate.updates.currentSalesAmount <= 0
				) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT sales amount: ${externalUpdate.updates.currentSalesAmount} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (sales amount)');
				}
				if (
					externalUpdate.updates.currentQuotationsAmount !== undefined &&
					externalUpdate.updates.currentQuotationsAmount <= 0
				) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT quotations amount: ${externalUpdate.updates.currentQuotationsAmount} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (quotations amount)');
				}
				if (
					externalUpdate.updates.currentOrdersAmount !== undefined &&
					externalUpdate.updates.currentOrdersAmount <= 0
				) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT orders amount: ${externalUpdate.updates.currentOrdersAmount} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (orders amount)');
				}
				if (
					externalUpdate.updates.currentNewLeads !== undefined &&
					externalUpdate.updates.currentNewLeads <= 0
				) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT new leads: ${externalUpdate.updates.currentNewLeads} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (new leads)');
				}
				if (
					externalUpdate.updates.currentNewClients !== undefined &&
					externalUpdate.updates.currentNewClients <= 0
				) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT new clients: ${externalUpdate.updates.currentNewClients} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (new clients)');
				}
				if (
					externalUpdate.updates.currentCheckIns !== undefined &&
					externalUpdate.updates.currentCheckIns <= 0
				) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT check-ins: ${externalUpdate.updates.currentCheckIns} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (check-ins)');
				}
				if (
					externalUpdate.updates.currentHoursWorked !== undefined &&
					externalUpdate.updates.currentHoursWorked <= 0
				) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT hours worked: ${externalUpdate.updates.currentHoursWorked} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (hours worked)');
				}
				if (externalUpdate.updates.currentCalls !== undefined && externalUpdate.updates.currentCalls <= 0) {
					this.logger.warn(
						`❌ [ERP_VALIDATION] Invalid INCREMENT calls: ${externalUpdate.updates.currentCalls} for user: ${userId}`,
					);
					errors.push('INCREMENT mode requires positive values (calls)');
				}
			} else if (externalUpdate.updateMode === TargetUpdateMode.DECREMENT) {
				// DECREMENT mode: Only accept positive values to subtract from current amounts
				if (
					externalUpdate.updates.currentSalesAmount !== undefined &&
					externalUpdate.updates.currentSalesAmount <= 0
				) {
					errors.push('DECREMENT mode requires positive values (sales amount)');
				}
				if (
					externalUpdate.updates.currentQuotationsAmount !== undefined &&
					externalUpdate.updates.currentQuotationsAmount <= 0
				) {
					errors.push('DECREMENT mode requires positive values (quotations amount)');
				}
				if (
					externalUpdate.updates.currentOrdersAmount !== undefined &&
					externalUpdate.updates.currentOrdersAmount <= 0
				) {
					errors.push('DECREMENT mode requires positive values (orders amount)');
				}
				if (
					externalUpdate.updates.currentNewLeads !== undefined &&
					externalUpdate.updates.currentNewLeads <= 0
				) {
					errors.push('DECREMENT mode requires positive values (new leads)');
				}
				if (
					externalUpdate.updates.currentNewClients !== undefined &&
					externalUpdate.updates.currentNewClients <= 0
				) {
					errors.push('DECREMENT mode requires positive values (new clients)');
				}
				if (
					externalUpdate.updates.currentCheckIns !== undefined &&
					externalUpdate.updates.currentCheckIns <= 0
				) {
					errors.push('DECREMENT mode requires positive values (check-ins)');
				}
				if (
					externalUpdate.updates.currentHoursWorked !== undefined &&
					externalUpdate.updates.currentHoursWorked <= 0
				) {
					errors.push('DECREMENT mode requires positive values (hours worked)');
				}
				if (externalUpdate.updates.currentCalls !== undefined && externalUpdate.updates.currentCalls <= 0) {
					errors.push('DECREMENT mode requires positive values (calls)');
				}

				// Validate that decrementing won't result in negative values
				if (externalUpdate.updates.currentSalesAmount !== undefined) {
					const finalAmount =
						(user.userTarget.currentSalesAmount || 0) - externalUpdate.updates.currentSalesAmount;
					if (finalAmount < 0) {
						errors.push(
							`Sales amount would become negative (current: ${
								user.userTarget.currentSalesAmount || 0
							} - ${externalUpdate.updates.currentSalesAmount} = ${finalAmount})`,
						);
					}
				}
				if (externalUpdate.updates.currentQuotationsAmount !== undefined) {
					const finalAmount =
						(user.userTarget.currentQuotationsAmount || 0) - externalUpdate.updates.currentQuotationsAmount;
					if (finalAmount < 0) {
						errors.push(
							`Quotations amount would become negative (current: ${
								user.userTarget.currentQuotationsAmount || 0
							} - ${externalUpdate.updates.currentQuotationsAmount} = ${finalAmount})`,
						);
					}
				}
				if (externalUpdate.updates.currentOrdersAmount !== undefined) {
					const finalAmount =
						(user.userTarget.currentOrdersAmount || 0) - externalUpdate.updates.currentOrdersAmount;
					if (finalAmount < 0) {
						errors.push(
							`Orders amount would become negative (current: ${
								user.userTarget.currentOrdersAmount || 0
							} - ${externalUpdate.updates.currentOrdersAmount} = ${finalAmount})`,
						);
					}
				}
				if (externalUpdate.updates.currentNewLeads !== undefined) {
					const finalCount = (user.userTarget.currentNewLeads || 0) - externalUpdate.updates.currentNewLeads;
					if (finalCount < 0) {
						errors.push(
							`New leads count would become negative (current: ${
								user.userTarget.currentNewLeads || 0
							} - ${externalUpdate.updates.currentNewLeads} = ${finalCount})`,
						);
					}
				}
				if (externalUpdate.updates.currentNewClients !== undefined) {
					const finalCount =
						(user.userTarget.currentNewClients || 0) - externalUpdate.updates.currentNewClients;
					if (finalCount < 0) {
						errors.push(
							`New clients count would become negative (current: ${
								user.userTarget.currentNewClients || 0
							} - ${externalUpdate.updates.currentNewClients} = ${finalCount})`,
						);
					}
				}
				if (externalUpdate.updates.currentCheckIns !== undefined) {
					const finalCount = (user.userTarget.currentCheckIns || 0) - externalUpdate.updates.currentCheckIns;
					if (finalCount < 0) {
						errors.push(
							`Check-ins count would become negative (current: ${
								user.userTarget.currentCheckIns || 0
							} - ${externalUpdate.updates.currentCheckIns} = ${finalCount})`,
						);
					}
				}
				if (externalUpdate.updates.currentHoursWorked !== undefined) {
					const finalHours =
						(user.userTarget.currentHoursWorked || 0) - externalUpdate.updates.currentHoursWorked;
					if (finalHours < 0) {
						errors.push(
							`Hours worked would become negative (current: ${
								user.userTarget.currentHoursWorked || 0
							} - ${externalUpdate.updates.currentHoursWorked} = ${finalHours})`,
						);
					}
				}
				if (externalUpdate.updates.currentCalls !== undefined) {
					const finalCalls = (user.userTarget.currentCalls || 0) - externalUpdate.updates.currentCalls;
					if (finalCalls < 0) {
						errors.push(
							`Calls count would become negative (current: ${user.userTarget.currentCalls || 0} - ${
								externalUpdate.updates.currentCalls
							} = ${finalCalls})`,
						);
					}
				}
			} else {
				// For REPLACE mode, validate the absolute values are not negative
				if (
					externalUpdate.updates.currentSalesAmount !== undefined &&
					externalUpdate.updates.currentSalesAmount < 0
				) {
					errors.push('Sales amount cannot be negative in REPLACE mode');
				}

				if (
					externalUpdate.updates.currentQuotationsAmount !== undefined &&
					externalUpdate.updates.currentQuotationsAmount < 0
				) {
					errors.push('Quotations amount cannot be negative in REPLACE mode');
				}

				if (
					externalUpdate.updates.currentOrdersAmount !== undefined &&
					externalUpdate.updates.currentOrdersAmount < 0
				) {
					errors.push('Orders amount cannot be negative in REPLACE mode');
				}

				if (
					externalUpdate.updates.currentNewLeads !== undefined &&
					externalUpdate.updates.currentNewLeads < 0
				) {
					errors.push('New leads count cannot be negative in REPLACE mode');
				}

				if (
					externalUpdate.updates.currentNewClients !== undefined &&
					externalUpdate.updates.currentNewClients < 0
				) {
					errors.push('New clients count cannot be negative in REPLACE mode');
				}

				if (
					externalUpdate.updates.currentCheckIns !== undefined &&
					externalUpdate.updates.currentCheckIns < 0
				) {
					errors.push('Check-ins count cannot be negative in REPLACE mode');
				}

				if (
					externalUpdate.updates.currentHoursWorked !== undefined &&
					externalUpdate.updates.currentHoursWorked < 0
				) {
					errors.push('Hours worked cannot be negative in REPLACE mode');
				}

				if (externalUpdate.updates.currentCalls !== undefined && externalUpdate.updates.currentCalls < 0) {
					errors.push('Calls count cannot be negative in REPLACE mode');
				}
			}

			// Validate transaction ID for idempotency
			this.logger.debug(`🆔 [ERP_VALIDATION] Validating transaction ID for user: ${userId}`);
			if (!externalUpdate.transactionId || externalUpdate.transactionId.trim() === '') {
				this.logger.warn(`❌ [ERP_VALIDATION] Missing transaction ID for user: ${userId}`);
				errors.push('Transaction ID is required for idempotency');
			} else {
				this.logger.debug(
					`✅ [ERP_VALIDATION] Transaction ID valid: ${externalUpdate.transactionId} for user: ${userId}`,
				);
			}

			// Validate source system
			// Source is now optional - no validation required
			this.logger.debug(`✅ [ERP_VALIDATION] Source field validation skipped (optional) for user: ${userId}`);

			const isValid = errors.length === 0;

			return {
				isValid,
				errors,
			};
		} catch (error) {
			this.logger.error(`🚨 [ERP_VALIDATION] EXCEPTION during validation for user ${userId}:`, {
				error: error.message,
				errorType: error.constructor.name,
				userId,
				transactionId: externalUpdate.transactionId,
				stackTrace: error.stack,
			});
			errors.push('Error validating update data');
			return {
				isValid: false,
				errors,
			};
		}
	}

	/**
	 * Create audit trail for target updates
	 * @private
	 */
	private async createTargetUpdateAuditLog(
		transactionalEntityManager: any,
		userId: number,
		source: string,
		transactionId: string,
		beforeValues: UserTarget,
		afterValues: Partial<UserTarget>,
	): Promise<void> {
		const auditStartTime = Date.now();
		this.logger.debug(
			`📝 [ERP_AUDIT] Starting audit log creation for user: ${userId}, transaction: ${transactionId}`,
		);

		try {
			// Calculate deltas for better audit tracking
			const deltas = {
				salesAmountDelta:
					(afterValues.currentSalesAmount ?? beforeValues.currentSalesAmount ?? 0) -
					(beforeValues.currentSalesAmount ?? 0),
				quotationsAmountDelta:
					(afterValues.currentQuotationsAmount ?? beforeValues.currentQuotationsAmount ?? 0) -
					(beforeValues.currentQuotationsAmount ?? 0),
				ordersAmountDelta:
					(afterValues.currentOrdersAmount ?? beforeValues.currentOrdersAmount ?? 0) -
					(beforeValues.currentOrdersAmount ?? 0),
				newLeadsDelta:
					(afterValues.currentNewLeads ?? beforeValues.currentNewLeads ?? 0) -
					(beforeValues.currentNewLeads ?? 0),
				newClientsDelta:
					(afterValues.currentNewClients ?? beforeValues.currentNewClients ?? 0) -
					(beforeValues.currentNewClients ?? 0),
				checkInsDelta:
					(afterValues.currentCheckIns ?? beforeValues.currentCheckIns ?? 0) -
					(beforeValues.currentCheckIns ?? 0),
				hoursWorkedDelta:
					(afterValues.currentHoursWorked ?? beforeValues.currentHoursWorked ?? 0) -
					(beforeValues.currentHoursWorked ?? 0),
				callsDelta:
					(afterValues.currentCalls ?? beforeValues.currentCalls ?? 0) - (beforeValues.currentCalls ?? 0),
			};

			// Log summary of changes for quick analysis
			const changedFields = Object.keys(afterValues).filter(
				(key) => afterValues[key] !== undefined && afterValues[key] !== beforeValues[key],
			);

			if (changedFields.length > 0) {
				this.logger.log(
					`📊 [ERP_AUDIT] Summary: ${
						changedFields.length
					} fields updated for user ${userId} from ${source}: ${changedFields.join(', ')}`,
				);
			}

			const auditTime = Date.now() - auditStartTime;
			this.logger.debug(
				`✅ [ERP_AUDIT] Audit log creation completed for user: ${userId}, transaction: ${transactionId} in ${auditTime}ms`,
			);
		} catch (error) {
			const auditTime = Date.now() - auditStartTime;
			this.logger.error(
				`❌ [ERP_AUDIT] Error creating target update audit log for user ${userId}, transaction ${transactionId}:`,
				{
					error: error.message,
					errorType: error.constructor.name,
					userId,
					source,
					transactionId,
					auditTime,
					stackTrace: error.stack,
				},
			);
			// Don't throw error as this shouldn't fail the main operation
		}
	}

	/**
	 * Send target achievement notification email
	 * @param userId - User ID who achieved the target
	 * @param targetType - Type of target achieved (Sales, Leads, etc.)
	 * @param achievementData - Achievement details
	 */
	async sendTargetAchievementEmail(
		userId: number,
		targetType: string,
		achievementData: {
			achievementPercentage: number;
			currentValue: number;
			targetValue: number;
			achievementDate: string;
			periodStartDate: string;
			periodEndDate: string;
			motivationalMessage?: string;
		},
	): Promise<void> {
		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.error(`User ${userId} not found for target achievement email`);
				return;
			}

			const emailData = {
				name: `${user.name} ${user.surname}`.trim(),
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				targetType,
				achievementPercentage: achievementData.achievementPercentage,
				currentValue: achievementData.currentValue,
				targetValue: achievementData.targetValue,
				achievementDate: achievementData.achievementDate,
				organizationName: user.organisation?.name || 'Organization',
				branchName: user.branch?.name,
				periodStartDate: achievementData.periodStartDate,
				periodEndDate: achievementData.periodEndDate,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
				motivationalMessage: achievementData.motivationalMessage,
				mobileAppInfo: {
					appStoreUrl: 'https://apps.apple.com/app/loro-crm/id123456789',
					googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.loro.crm',
					appName: 'Loro CRM Mobile',
					features: [
						'Real-time achievement notifications',
						'Interactive progress visualization',
						'Offline achievement tracking',
						'Mobile-optimized celebration features',
					],
				},
			};

			this.eventEmitter.emit('send.email', EmailType.USER_TARGET_ACHIEVEMENT, [user.email], emailData);

			// Send push notification for target achievement
			try {
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.USER_TARGET_ACHIEVEMENT,
					[userId],
					{
						userName: emailData.userName,
						targetType,
						achievementPercentage: achievementData.achievementPercentage,
						currentValue: achievementData.currentValue,
						targetValue: achievementData.targetValue,
						organizationName: emailData.organizationName,
					},
					{
						priority: NotificationPriority.HIGH,
					},
				);
				this.logger.log(
					`Target achievement email & push notification sent to user ${userId} for ${targetType} target`,
				);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send target achievement push notification to user ${userId}:`,
					notificationError.message,
				);
				this.logger.log(`Target achievement email sent to user ${userId} for ${targetType} target`);
			}
		} catch (error) {
			this.logger.error(`Error sending target achievement email to user ${userId}:`, error.message);
		}
	}

	/**
	 * Send target milestone notification email
	 * @param userId - User ID who reached the milestone
	 * @param targetType - Type of target
	 * @param milestoneData - Milestone details
	 */
	async sendTargetMilestoneEmail(
		userId: number,
		targetType: string,
		milestoneData: {
			milestonePercentage: number;
			currentValue: number;
			targetValue: number;
			remainingValue: number;
			milestoneName: string;
			periodStartDate: string;
			periodEndDate: string;
			daysRemaining: number;
			encouragementMessage?: string;
		},
	): Promise<void> {
		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.error(`User ${userId} not found for target milestone email`);
				return;
			}

			const emailData = {
				name: `${user.name} ${user.surname}`.trim(),
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				targetType,
				milestonePercentage: milestoneData.milestonePercentage,
				currentValue: milestoneData.currentValue,
				targetValue: milestoneData.targetValue,
				remainingValue: milestoneData.remainingValue,
				milestoneName: milestoneData.milestoneName,
				organizationName: user.organisation?.name || 'Organization',
				branchName: user.branch?.name,
				periodStartDate: milestoneData.periodStartDate,
				periodEndDate: milestoneData.periodEndDate,
				daysRemaining: milestoneData.daysRemaining,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
				encouragementMessage: milestoneData.encouragementMessage,
				mobileAppInfo: {
					appStoreUrl: 'https://apps.apple.com/app/loro-crm/id123456789',
					googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.loro.crm',
					appName: 'Loro CRM Mobile',
					features: [
						'Real-time milestone notifications',
						'Interactive progress tracking',
						'Mobile milestone celebrations',
						'Offline progress monitoring',
					],
				},
			};

			this.eventEmitter.emit('send.email', EmailType.USER_TARGET_MILESTONE, [user.email], emailData);

			// Send push notification for milestone achievement
			try {
				const milestoneMessage =
					milestoneData.milestonePercentage >= 100
						? `🎉 Congratulations! You've achieved your ${targetType} target (${milestoneData.currentValue}/${milestoneData.targetValue})! Excellent work!`
						: `🎯 Great progress! You've reached ${milestoneData.milestonePercentage}% of your ${targetType} target (${milestoneData.currentValue}/${milestoneData.targetValue}). Keep it up!`;

				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.USER_TARGET_MILESTONE,
					[userId],
					{
						message: milestoneMessage,
						userName: `${user.name} ${user.surname}`.trim(),
						targetType,
						milestonePercentage: milestoneData.milestonePercentage,
						currentValue: milestoneData.currentValue,
						targetValue: milestoneData.targetValue,
						remainingValue: milestoneData.remainingValue,
						milestoneName: milestoneData.milestoneName,
						periodStartDate: milestoneData.periodStartDate,
						periodEndDate: milestoneData.periodEndDate,
						daysRemaining: milestoneData.daysRemaining,
						encouragementMessage: milestoneData.encouragementMessage,
						isFullAchievement: milestoneData.milestonePercentage >= 100,
						timestamp: new Date().toISOString(),
					},
					{
						priority:
							milestoneData.milestonePercentage >= 100
								? NotificationPriority.HIGH
								: NotificationPriority.NORMAL,
					},
				);
				this.logger.debug(`Target milestone push notification sent to user: ${userId} for ${targetType}`);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send target milestone push notification to user ${userId}:`,
					notificationError.message,
				);
			}

			this.logger.log(`Target milestone email sent to user ${userId} for ${targetType} milestone`);
		} catch (error) {
			this.logger.error(`Error sending target milestone email to user ${userId}:`, error.message);
		}
	}

	/**
	 * Send target deadline reminder email
	 * @param userId - User ID to remind
	 * @param reminderData - Reminder details
	 */
	async sendTargetDeadlineReminderEmail(
		userId: number,
		reminderData: {
			targets: Array<{
				type: string;
				currentValue: number;
				targetValue: number;
				progressPercentage: number;
				gapValue: number;
			}>;
			periodEndDate: string;
			daysRemaining: number;
			urgencyLevel: 'low' | 'medium' | 'high';
			recommendedActions: string[];
		},
	): Promise<void> {
		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.error(`User ${userId} not found for target deadline reminder email`);
				return;
			}

			const emailData = {
				name: `${user.name} ${user.surname}`.trim(),
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				targets: reminderData.targets,
				organizationName: user.organisation?.name || 'Organization',
				branchName: user.branch?.name,
				periodEndDate: reminderData.periodEndDate,
				daysRemaining: reminderData.daysRemaining,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
				urgencyLevel: reminderData.urgencyLevel,
				recommendedActions: reminderData.recommendedActions,
			};

			this.eventEmitter.emit('send.email', EmailType.USER_TARGET_DEADLINE_REMINDER, [user.email], emailData);

			this.logger.log(
				`Target deadline reminder email sent to user ${userId} with urgency: ${reminderData.urgencyLevel}`,
			);
		} catch (error) {
			this.logger.error(`Error sending target deadline reminder email to user ${userId}:`, error.message);
		}
	}

	/**
	 * Send performance alert email
	 * @param userId - User ID with performance issues
	 * @param alertData - Performance alert details
	 */
	async sendTargetPerformanceAlertEmail(
		userId: number,
		alertData: {
			alertType: 'underperforming' | 'at_risk' | 'improvement_needed';
			targets: Array<{
				type: string;
				currentValue: number;
				targetValue: number;
				progressPercentage: number;
				expectedProgress: number;
				performanceGap: number;
			}>;
			periodStartDate: string;
			periodEndDate: string;
			daysElapsed: number;
			daysRemaining: number;
			managerName?: string;
			managerEmail?: string;
			improvementSuggestions: string[];
			supportResources: Array<{
				title: string;
				url?: string;
				description: string;
			}>;
		},
	): Promise<void> {
		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.error(`User ${userId} not found for performance alert email`);
				return;
			}

			const emailData = {
				name: `${user.name} ${user.surname}`.trim(),
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				alertType: alertData.alertType,
				targets: alertData.targets,
				organizationName: user.organisation?.name || 'Organization',
				branchName: user.branch?.name,
				periodStartDate: alertData.periodStartDate,
				periodEndDate: alertData.periodEndDate,
				daysElapsed: alertData.daysElapsed,
				daysRemaining: alertData.daysRemaining,
				managerName: alertData.managerName,
				managerEmail: alertData.managerEmail,
				improvementSuggestions: alertData.improvementSuggestions,
				supportResources: alertData.supportResources,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
			};

			this.eventEmitter.emit('send.email', EmailType.USER_TARGET_PERFORMANCE_ALERT, [user.email], emailData);

			this.logger.log(`Performance alert email sent to user ${userId} with alert type: ${alertData.alertType}`);
		} catch (error) {
			this.logger.error(`Error sending performance alert email to user ${userId}:`, error.message);
		}
	}

	/**
	 * Send ERP update confirmation email
	 * @param userId - User ID whose targets were updated
	 * @param updateData - Update confirmation details
	 */
	async sendTargetERPUpdateConfirmationEmail(
		userId: number,
		updateData: {
			updateSource: string;
			transactionId: string;
			updateDate: string;
			updatedTargets: Array<{
				type: string;
				previousValue: number;
				newValue: number;
				updateMode: 'increment' | 'replace';
			}>;
			updatedBy?: string;
			supportEmail: string;
		},
	): Promise<void> {
		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.error(`User ${userId} not found for ERP update confirmation email`);
				return;
			}

			const emailData = {
				name: `${user.name} ${user.surname}`.trim(),
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				updateSource: updateData.updateSource,
				transactionId: updateData.transactionId,
				updateDate: updateData.updateDate,
				updatedTargets: updateData.updatedTargets,
				organizationName: user.organisation?.name || 'Organization',
				branchName: user.branch?.name,
				updatedBy: updateData.updatedBy,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
				supportEmail: updateData.supportEmail,
			};

			this.eventEmitter.emit(
				'send.email',
				EmailType.USER_TARGET_ERP_UPDATE_CONFIRMATION,
				[user.email],
				emailData,
			);

			this.logger.log(
				`ERP update confirmation email sent to user ${userId} for transaction: ${updateData.transactionId}`,
			);
		} catch (error) {
			this.logger.error(`Error sending ERP update confirmation email to user ${userId}:`, error.message);
		}
	}

	/**
	 * Send period summary email
	 * @param userId - User ID for the summary
	 * @param summaryData - Period summary details
	 */
	async sendTargetPeriodSummaryEmail(
		userId: number,
		summaryData: {
			periodType: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
			periodStartDate: string;
			periodEndDate: string;
			overallPerformance: {
				achievedTargets: number;
				totalTargets: number;
				achievementRate: number;
				grade: string;
			};
			targetsSummary: Array<{
				type: string;
				achieved: boolean;
				currentValue: number;
				targetValue: number;
				progressPercentage: number;
				trend: 'improving' | 'declining' | 'stable';
			}>;
			achievements: string[];
			improvementAreas: string[];
			nextPeriodRecommendations: string[];
			managerName?: string;
			celebrateSuccess: boolean;
			recognitionMessage?: string;
		},
	): Promise<void> {
		try {
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.uid = :userId', { userId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.error(`User ${userId} not found for period summary email`);
				return;
			}

			const emailData = {
				name: `${user.name} ${user.surname}`.trim(),
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				periodType: summaryData.periodType,
				periodStartDate: summaryData.periodStartDate,
				periodEndDate: summaryData.periodEndDate,
				overallPerformance: summaryData.overallPerformance,
				targetsSummary: summaryData.targetsSummary,
				achievements: summaryData.achievements,
				improvementAreas: summaryData.improvementAreas,
				nextPeriodRecommendations: summaryData.nextPeriodRecommendations,
				organizationName: user.organisation?.name || 'Organization',
				branchName: user.branch?.name,
				managerName: summaryData.managerName,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/dashboard`,
				celebrateSuccess: summaryData.celebrateSuccess,
				recognitionMessage: summaryData.recognitionMessage,
			};

			this.eventEmitter.emit('send.email', EmailType.USER_TARGET_PERIOD_SUMMARY, [user.email], emailData);

			this.logger.log(`Period summary email sent to user ${userId} for ${summaryData.periodType} period`);
		} catch (error) {
			this.logger.error(`Error sending period summary email to user ${userId}:`, error.message);
		}
	}

	/**
	 * Send push notification when targets are updated from ERP
	 * @param userId - User ID to send notification to
	 * @param externalUpdate - The external update data from ERP
	 * @param updatedValues - The calculated updated values
	 */
	private async sendTargetUpdatePushNotification(
		userId: number,
		externalUpdate: ExternalTargetUpdateDto,
		updatedValues: Partial<UserTarget>,
	): Promise<void> {
		const notificationStartTime = Date.now();
		this.logger.debug(
			`📱 [ERP_NOTIFICATION] Starting push notification for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
		);

		try {
			// Get user details with timeout
			this.logger.debug(`👤 [ERP_NOTIFICATION] Fetching user details for push notification user: ${userId}`);
			const user = await Promise.race([
				this.userRepository
					.createQueryBuilder('user')
					.leftJoinAndSelect('user.userTarget', 'userTarget')
					.leftJoinAndSelect('user.organisation', 'organisation')
					.leftJoinAndSelect('user.branch', 'branch')
					.where('user.uid = :userId', { userId })
					.getOne(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('User query timeout for push notification')), 3000),
				),
			]);

			if (!user) {
				this.logger.warn(
					`⚠️ [ERP_NOTIFICATION] User ${userId} not found for target update push notification - transaction: ${externalUpdate.transactionId}`,
				);
				return;
			}

			this.logger.debug(
				`✅ [ERP_NOTIFICATION] User found: ${user.name} ${user.surname} (${user.email}) for push notification`,
			);

			// Determine notification message based on update mode
			let title = '🎯 Target Update';
			let message = '';
			let priority = 'NORMAL' as any;

			switch (externalUpdate.updateMode) {
				case 'INCREMENT':
					title = '📈 Progress Update!';
					message = `Your targets have been updated with new progress from ${
						externalUpdate.source || 'external system'
					}`;
					priority = 'HIGH';
					break;
				case 'REPLACE':
					title = '🔄 Target Reset';
					message = `Your targets have been updated by ${externalUpdate.source || 'external system'}`;
					priority = 'NORMAL';
					break;
				case 'DECREMENT':
					title = '📉 Target Adjustment';
					message = `Your targets have been adjusted by ${externalUpdate.source || 'external system'}`;
					priority = 'NORMAL';
					break;
				default:
					title = '🎯 Target Update';
					message = `Your targets have been updated from ${externalUpdate.source || 'external system'}`;
					priority = 'NORMAL';
			}

		// Send push notification using unified notification service
		// Extract target type and new value from updatedValues
		const updatedFields = Object.entries(updatedValues);
		const primaryField = updatedFields[0] || ['unknown', 0];
		const [fieldName, fieldValue] = primaryField;
		
		// Format field name to human-readable target type
		const targetType = fieldName
			.replace(/([A-Z])/g, ' $1') // Add space before capital letters
			.replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
			.trim();
		
		// Format the new value (handle currency formatting for sales amounts)
		const newTargetValue = fieldName.toLowerCase().includes('amount')
			? new Intl.NumberFormat('en-US', {
					style: 'currency',
					currency: 'USD',
					minimumFractionDigits: 2,
			  }).format(Number(fieldValue))
			: String(fieldValue);

		const notificationPayload = {
			sourceSystem: externalUpdate.source || 'external system',
			updateMode: externalUpdate.updateMode,
			transactionId: externalUpdate.transactionId,
			updatedValues,
			updateTime: new Date().toLocaleString(),
			title,
			message,
			userId,
			organizationName: user.organisation?.name || 'Your Organization',
			branchName: user.branch?.name || 'Your Branch',
			targetType,
			newTargetValue,
		};

			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.USER_TARGET_UPDATED,
				[userId],
				notificationPayload,
				{
					priority,
				},
			);

			const notificationTime = Date.now() - notificationStartTime;
			this.logger.log(
				`✅ [ERP_NOTIFICATION] Push notification sent successfully to user ${userId} for target update from ${
					externalUpdate.source || 'external system'
				} in ${notificationTime}ms`,
			);
		} catch (error) {
			const notificationTime = Date.now() - notificationStartTime;
			this.logger.error(
				`❌ [ERP_NOTIFICATION] Error sending target update push notification to user ${userId} after ${notificationTime}ms:`,
				{
					error: error.message,
					errorType: error.constructor.name,
					userId,
					transactionId: externalUpdate.transactionId,
					source: externalUpdate.source || 'external system',
					updateMode: externalUpdate.updateMode,
					notificationTime,
					stackTrace: error.stack,
				},
			);

			// Don't throw error as notification failure shouldn't fail the main ERP update
			// Just log the failure for monitoring
			this.logger.warn(
				`⚠️ [ERP_NOTIFICATION] Push notification failure will not affect ERP update success for user ${userId}, transaction ${externalUpdate.transactionId}`,
			);
		}
	}

	/**
	 * Send contribution progress notification (both email and push) when ERP updates show increases
	 * @param userId - User ID to send notification to
	 * @param externalUpdate - The external update data from ERP
	 * @param updatedValues - The calculated updated values
	 */
	private async sendContributionProgressNotification(
		userId: number,
		externalUpdate: ExternalTargetUpdateDto,
		updatedValues: Partial<UserTarget>,
	): Promise<void> {
		const contributionStartTime = Date.now();
		this.logger.debug(
			`📧 [ERP_CONTRIBUTION] Starting contribution progress notification for user: ${userId}, transaction: ${externalUpdate.transactionId}`,
		);

		try {
			// Only send notifications for INCREMENT mode as these represent actual progress
			if (externalUpdate.updateMode !== TargetUpdateMode.INCREMENT) {
				this.logger.debug(
					`⏭️ [ERP_CONTRIBUTION] Skipping contribution progress notification for user ${userId} - update mode: ${externalUpdate.updateMode} (not INCREMENT)`,
				);
				return;
			}

			this.logger.debug(
				`🔍 [ERP_CONTRIBUTION] Fetching user details for contribution notification user: ${userId}`,
			);

			// Get user details with timeout
			const user = await Promise.race([
				this.userRepository
					.createQueryBuilder('user')
					.leftJoinAndSelect('user.userTarget', 'userTarget')
					.leftJoinAndSelect('user.organisation', 'organisation')
					.leftJoinAndSelect('user.branch', 'branch')
					.where('user.uid = :userId', { userId })
					.getOne(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('User query timeout for contribution notification')), 5000),
				),
			]);

			if (!user) {
				this.logger.warn(
					`⚠️ [ERP_CONTRIBUTION] User ${userId} not found for contribution progress notification - transaction: ${externalUpdate.transactionId}`,
				);
				return;
			}

			this.logger.debug(
				`✅ [ERP_CONTRIBUTION] User found: ${user.name} ${user.surname} (${user.email}) for contribution notification`,
			);

			// Calculate contribution progress data
			const contributionProgress = [];
			let totalProgressImprovement = 0;
			let hasSignificantProgress = false;

			// Check sales amount progress
			if (externalUpdate.updates.currentSalesAmount && externalUpdate.updates.currentSalesAmount > 0) {
				const previousValue =
					(user.userTarget?.currentSalesAmount || 0) - externalUpdate.updates.currentSalesAmount;
				const newValue = user.userTarget?.currentSalesAmount || 0;
				const targetValue = user.userTarget?.targetSalesAmount || 0;
				const increase = externalUpdate.updates.currentSalesAmount;
				const increasePercentage = previousValue > 0 ? Math.round((increase / previousValue) * 100) : 100;
				const progressPercentage = targetValue > 0 ? Math.round((newValue / targetValue) * 100) : 0;

				contributionProgress.push({
					type: 'Sales',
					previousValue,
					newValue,
					increase,
					increasePercentage,
					targetValue,
					progressPercentage,
					currency: user.userTarget?.targetCurrency || 'ZAR',
					formattedPrevious: `${user.userTarget?.targetCurrency || 'ZAR'} ${previousValue.toLocaleString()}`,
					formattedNew: `${user.userTarget?.targetCurrency || 'ZAR'} ${newValue.toLocaleString()}`,
					formattedIncrease: `${user.userTarget?.targetCurrency || 'ZAR'} ${increase.toLocaleString()}`,
					formattedTarget: `${user.userTarget?.targetCurrency || 'ZAR'} ${targetValue.toLocaleString()}`,
				});

				totalProgressImprovement += Math.min(increasePercentage, 50); // Cap individual contributions
				hasSignificantProgress = true;
			}

			// Check other metrics (quotations, orders, leads, clients, etc.)
			const metricsToCheck = [
				{
					key: 'currentQuotationsAmount',
					label: 'Quotations',
					target: 'targetQuotationsAmount',
					hasCurrency: true,
				},
				{ key: 'currentOrdersAmount', label: 'Orders', target: 'targetOrdersAmount', hasCurrency: true },
				{ key: 'currentNewLeads', label: 'New Leads', target: 'targetNewLeads', hasCurrency: false },
				{ key: 'currentNewClients', label: 'New Clients', target: 'targetNewClients', hasCurrency: false },
				{ key: 'currentCheckIns', label: 'Check-ins', target: 'targetCheckIns', hasCurrency: false },
				{ key: 'currentCalls', label: 'Calls', target: 'targetCalls', hasCurrency: false },
				{ key: 'currentHoursWorked', label: 'Hours Worked', target: 'targetHoursWorked', hasCurrency: false },
			];

			for (const metric of metricsToCheck) {
				const updateValue = externalUpdate.updates[metric.key];
				if (updateValue && updateValue > 0) {
					const previousValue = (user.userTarget?.[metric.key] || 0) - updateValue;
					const newValue = user.userTarget?.[metric.key] || 0;
					const targetValue = user.userTarget?.[metric.target] || 0;
					const increase = updateValue;
					const increasePercentage = previousValue > 0 ? Math.round((increase / previousValue) * 100) : 100;
					const progressPercentage = targetValue > 0 ? Math.round((newValue / targetValue) * 100) : 0;

					const progressItem: any = {
						type: metric.label,
						previousValue,
						newValue,
						increase,
						increasePercentage,
						targetValue,
						progressPercentage,
					};

					if (metric.hasCurrency) {
						const currency = user.userTarget?.targetCurrency || 'ZAR';
						progressItem.currency = currency;
						progressItem.formattedPrevious = `${currency} ${previousValue.toLocaleString()}`;
						progressItem.formattedNew = `${currency} ${newValue.toLocaleString()}`;
						progressItem.formattedIncrease = `${currency} ${increase.toLocaleString()}`;
						progressItem.formattedTarget = `${currency} ${targetValue.toLocaleString()}`;
					}

					contributionProgress.push(progressItem);
					totalProgressImprovement += Math.min(increasePercentage, 30); // Cap individual contributions
					hasSignificantProgress = true;
				}
			}

			// Only send notification if there's significant progress
			if (!hasSignificantProgress || contributionProgress.length === 0) {
				this.logger.debug(`No significant contribution progress for user ${userId} - skipping notification`);
				return;
			}

			// Cap total progress improvement at reasonable level
			totalProgressImprovement = Math.min(totalProgressImprovement, 100);

			// Generate motivational messages and tips
			const motivationalMessages = [
				'Fantastic progress! Your hard work is really paying off.',
				"You're building great momentum with these results!",
				"Excellent work! Keep this pace and you'll exceed your targets.",
				'Your dedication is showing in these numbers - well done!',
				"Outstanding progress! You're on track for great results.",
			];

			const encouragementTips = [
				'📈 Keep tracking your daily activities to maintain this momentum',
				'🎯 Focus on consistency - small daily improvements add up',
				"💪 Your current pace suggests you'll reach your targets ahead of schedule",
				'⭐ Share your success strategies with team members',
				"🚀 Consider setting stretch goals as you're performing so well",
			];

			// Determine performance trend
			let performanceTrend: 'excellent' | 'good' | 'steady' | 'improving' = 'improving';
			if (totalProgressImprovement >= 50) performanceTrend = 'excellent';
			else if (totalProgressImprovement >= 30) performanceTrend = 'good';
			else if (totalProgressImprovement >= 15) performanceTrend = 'improving';

			// Prepare email data
			const emailData = {
				name: `${user.name} ${user.surname}`.trim(),
				userName: `${user.name} ${user.surname}`.trim(),
				userEmail: user.email,
				updateDate: new Date().toISOString(),
				updateSource: externalUpdate.source || 'EXTERNAL_SOURCE',
				contributionProgress,
				totalProgressImprovement,
				organizationName: user.organisation?.name || 'Your Organization',
				branchName: user.branch?.name,
				periodStartDate: user.userTarget?.periodStartDate
					? new Date(user.userTarget.periodStartDate).toISOString()
					: undefined,
				periodEndDate: user.userTarget?.periodEndDate
					? new Date(user.userTarget.periodEndDate).toISOString()
					: undefined,
				daysRemaining: user.userTarget?.periodEndDate
					? await this.calculateWorkingDaysRemaining(
							user.userTarget.periodEndDate,
							user.organisation?.ref
					  ).catch(() => {
							// Fall back to simple calculation if working days calculation fails
							return Math.max(
								0,
								Math.ceil(
									(new Date(user.userTarget.periodEndDate).getTime() - new Date().getTime()) /
										(1000 * 60 * 60 * 24),
								),
							);
					  })
					: undefined,
				motivationalMessage: motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)],
				encouragementTips: encouragementTips.slice(0, 3), // Send 3 tips
				performanceTrend,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/targets`,
				supportEmail: this.configService.get('SUPPORT_EMAIL') || 'support@loro.co.za',
			};

			// Email notification removed to reduce Gmail quota usage - push notification only
			this.logger.debug(
				`⏭️ [ERP_CONTRIBUTION] Skipping email notification for user: ${userId} - push notification will be sent instead`,
			);

			// Send push notification
			try {
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.USER_TARGET_CONTRIBUTION_PROGRESS,
					[userId],
					{
						totalProgressImprovement,
						userName: emailData.userName,
						organizationName: emailData.organizationName,
						contributionCount: contributionProgress.length,
					},
					{
						priority: NotificationPriority.HIGH,
					},
				);
				this.logger.log(`✅ Contribution progress push notification sent to user: ${userId}`);
			} catch (pushError) {
				this.logger.warn(
					`Failed to send contribution progress push notification to user ${userId}: ${pushError.message}`,
				);
				// Don't fail the email if push notification fails
			}
		} catch (error) {
			const contributionTime = Date.now() - contributionStartTime;
			this.logger.error(
				`❌ [ERP_CONTRIBUTION] Error sending contribution progress notification to user ${userId} after ${contributionTime}ms:`,
				{
					error: error.message,
					errorType: error.constructor.name,
					userId,
					transactionId: externalUpdate.transactionId,
					source: externalUpdate.source || 'EXTERNAL_SOURCE',
					updateMode: externalUpdate.updateMode,
					contributionTime,
					stackTrace: error.stack,
					updatedFieldsCount: Object.keys(updatedValues).length,
				},
			);

			// Don't throw error as contribution notification failure shouldn't fail the main ERP update
			// Just log the failure for monitoring
			this.logger.warn(
				`⚠️ [ERP_CONTRIBUTION] Contribution progress notification failure will not affect ERP update success for user ${userId}, transaction ${externalUpdate.transactionId}`,
			);
		}
	}

	/**
	 * Send target updated notification email
	 * @param userId - User ID whose targets were updated
	 * @param targetDetails - Details of the updated targets
	 * @param updatedBy - Information about who updated the targets
	 * @param changes - Array of changes made to the targets
	 */

	/**
	 * Add clients to a user's assigned clients list
	 * @param userId - User ID to add clients to
	 * @param clientIds - Array of client IDs to add
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Success message or error details
	 */
	async addAssignedClients(
		userId: number,
		clientIds: number[],
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; addedClients?: number[] }> {
		const startTime = Date.now();
		this.logger.log(`Adding assigned clients to user ${userId}: ${clientIds.join(', ')}`);

		try {
			// Build where conditions
			const whereConditions: any = {
				uid: userId,
				isDeleted: false,
			};

			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where(whereConditions)
				.getOne();

			if (!user) {
				this.logger.warn(`User ${userId} not found for adding assigned clients`);
				throw new NotFoundException('User not found');
			}

			// Get current assigned clients or initialize empty array
			const currentAssignedClients = user.assignedClientIds || [];

			// Add new client IDs (avoid duplicates)
			const newClientIds = clientIds.filter((id) => !currentAssignedClients.includes(id));
			const updatedAssignedClients = [...currentAssignedClients, ...newClientIds];

			// Update user with new assigned clients
			await this.userRepository.update(userId, {
				assignedClientIds: updatedAssignedClients,
			});

			// Invalidate cache
			await this.invalidateUserCache(user);

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`Successfully added ${newClientIds.length} clients to user ${userId} in ${executionTime}ms`,
			);

			return {
				message: 'Clients assigned successfully',
				addedClients: newClientIds,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to add assigned clients to user ${userId} after ${executionTime}ms: ${error.message}`,
			);

			return {
				message: error.message || 'Failed to add assigned clients',
			};
		}
	}

	/**
	 * Remove clients from a user's assigned clients list
	 * @param userId - User ID to remove clients from
	 * @param clientIds - Array of client IDs to remove
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Success message or error details
	 */
	async removeAssignedClients(
		userId: number,
		clientIds: number[],
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; removedClients?: number[] }> {
		const startTime = Date.now();
		this.logger.log(`Removing assigned clients from user ${userId}: ${clientIds.join(', ')}`);

		try {
			// Build where conditions
			const whereConditions: any = {
				uid: userId,
				isDeleted: false,
			};

			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where(whereConditions)
				.getOne();

			if (!user) {
				this.logger.warn(`User ${userId} not found for removing assigned clients`);
				throw new NotFoundException('User not found');
			}

			// Get current assigned clients
			const currentAssignedClients = user.assignedClientIds || [];

			// Remove specified client IDs
			const updatedAssignedClients = currentAssignedClients.filter((id) => !clientIds.includes(id));
			const removedClients = clientIds.filter((id) => currentAssignedClients.includes(id));

			// Update user with updated assigned clients
			await this.userRepository.update(userId, {
				assignedClientIds: updatedAssignedClients,
			});

			// Invalidate cache
			await this.invalidateUserCache(user);

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`Successfully removed ${removedClients.length} clients from user ${userId} in ${executionTime}ms`,
			);

			return {
				message: 'Clients removed successfully',
				removedClients,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to remove assigned clients from user ${userId} after ${executionTime}ms: ${error.message}`,
			);

			return {
				message: error.message || 'Failed to remove assigned clients',
			};
		}
	}

	/**
	 * Get a user's assigned clients list
	 * @param userId - User ID to get assigned clients for
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Array of assigned client IDs or null with message
	 */
	async getAssignedClients(
		userId: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; assignedClients: number[] | null }> {
		const startTime = Date.now();
		this.logger.log(`Getting assigned clients for user ${userId}`);

		try {
			// Build where conditions
			const whereConditions: any = {
				uid: userId,
				isDeleted: false,
			};

			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			const user = await this.userRepository.findOne({
				where: whereConditions,
				select: ['uid', 'assignedClientIds'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found for getting assigned clients`);
				throw new NotFoundException('User not found');
			}

			const assignedClients = user.assignedClientIds || [];

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`Successfully retrieved ${assignedClients.length} assigned clients for user ${userId} in ${executionTime}ms`,
			);

			return {
				message: 'Assigned clients retrieved successfully',
				assignedClients,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to get assigned clients for user ${userId} after ${executionTime}ms: ${error.message}`,
			);

			return {
				message: error.message || 'Failed to get assigned clients',
				assignedClients: null,
			};
		}
	}

	/**
	 * Set a user's assigned clients list (replaces existing list)
	 * @param userId - User ID to set assigned clients for
	 * @param clientIds - Array of client IDs to set
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Success message or error details
	 */
	async setAssignedClients(
		userId: number,
		clientIds: number[],
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; assignedClients?: number[] }> {
		const startTime = Date.now();
		this.logger.log(`Setting assigned clients for user ${userId}: ${clientIds.join(', ')}`);

		try {
			// Build where conditions
			const whereConditions: any = {
				uid: userId,
				isDeleted: false,
			};

			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where(whereConditions)
				.getOne();

			if (!user) {
				this.logger.warn(`User ${userId} not found for setting assigned clients`);
				throw new NotFoundException('User not found');
			}

			// Remove duplicates from input
			const uniqueClientIds = [...new Set(clientIds)];

			// Update user with new assigned clients
			await this.userRepository.update(userId, {
				assignedClientIds: uniqueClientIds,
			});

			// Invalidate cache
			await this.invalidateUserCache(user);

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`Successfully set ${uniqueClientIds.length} assigned clients for user ${userId} in ${executionTime}ms`,
			);

			return {
				message: 'Assigned clients set successfully',
				assignedClients: uniqueClientIds,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to set assigned clients for user ${userId} after ${executionTime}ms: ${error.message}`,
			);

			return {
				message: error.message || 'Failed to set assigned clients',
			};
		}
	}

	/**
	 * Send comprehensive user creation notification email with client assignments
	 * @param user - User that was created
	 * @param assignedClientIds - Array of assigned client IDs
	 */
	private async sendUserCreationWithClientsNotificationEmail(user: User, assignedClientIds: number[]): Promise<void> {
		const startTime = Date.now();
		this.logger.debug(
			`Preparing comprehensive user creation email with client assignments for: ${user.email} (${user.uid})`,
		);

		try {
			// Get assigned clients information
			let assignedClientsInfo = [];
			if (assignedClientIds && assignedClientIds.length > 0) {
				try {
					const clients = await Promise.race([
						this.clientRepository.find({
							where: {
								uid: In(assignedClientIds),
								isDeleted: false,
							},
							select: ['uid', 'name', 'contactPerson', 'email', 'phone', 'status'],
						}),
						new Promise<never>((_, reject) =>
							setTimeout(() => reject(new Error('Client query timeout')), 3000),
						),
					]);
					assignedClientsInfo = clients;
				} catch (error) {
					this.logger.warn(`Failed to fetch client details for user creation email: ${error.message}`);
					// Continue with basic client IDs
					assignedClientsInfo = assignedClientIds.map((id) => ({ uid: id, name: `Client ${id}` }));
				}
			}

			const emailData = {
				userEmail: user.email,
				userName: `${user.name} ${user.surname}`,
				userFirstName: user.name,
				platformName: 'Loro CRM',
				loginUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za/sign-in',
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				organizationName: user.organisation?.name || 'Your Organization',
				branchName: user.branch?.name || 'Main Branch',
				dashboardUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za',
				assignedClientsCount: assignedClientsInfo.length,
				assignedClients: assignedClientsInfo,
				accountDetails: {
					name: `${user.name} ${user.surname}`,
					email: user.email,
					username: user.username,
					role: user.accessLevel,
					branch: user.branch?.name,
				},
			};

			// Send email through event emitter
			this.eventEmitter.emit('send.email', EmailType.NEW_USER_WELCOME, [user.email], emailData);

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`[EMAIL] User creation with clients notification sent to: ${user.email} in ${executionTime}ms`,
			);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[EMAIL] Failed to send user creation with clients notification to ${user.email} after ${executionTime}ms: ${error.message}`,
			);
		}
	}

	/**
	 * Send comprehensive user update notification email
	 * @param updatedUser - Updated user data
	 * @param originalUser - Original user data before update
	 * @param changes - Object tracking what changed
	 * @param originalAssignedClients - Original assigned client IDs
	 * @param updatedAssignedClients - Updated assigned client IDs
	 */
	private async sendComprehensiveUserUpdateEmail(
		updatedUser: User,
		originalUser: User,
		changes: {
			role: boolean;
			status: boolean;
			profile: boolean;
			assignedClients: boolean;
		},
		originalAssignedClients: number[],
		updatedAssignedClients: number[],
	): Promise<void> {
		const startTime = Date.now();
		this.logger.debug(`Preparing comprehensive user update email for: ${updatedUser.email} (${updatedUser.uid})`);

		try {
			// Get client assignment changes
			let clientChanges = null;
			if (changes.assignedClients) {
				const addedClients = updatedAssignedClients.filter((id) => !originalAssignedClients.includes(id));
				const removedClients = originalAssignedClients.filter((id) => !updatedAssignedClients.includes(id));

				// Get client details for added clients
				let addedClientsInfo = [];
				let removedClientsInfo = [];

				if (addedClients.length > 0 || removedClients.length > 0) {
					try {
						const allRelevantClientIds = [...addedClients, ...removedClients];
						const clients = await Promise.race([
							this.clientRepository.find({
								where: {
									uid: In(allRelevantClientIds),
									isDeleted: false,
								},
								select: ['uid', 'name', 'contactPerson', 'email'],
							}),
							new Promise<never>((_, reject) =>
								setTimeout(() => reject(new Error('Client query timeout')), 3000),
							),
						]);

						addedClientsInfo = clients.filter((c) => addedClients.includes(c.uid));
						removedClientsInfo = clients.filter((c) => removedClients.includes(c.uid));
					} catch (error) {
						this.logger.warn(`Failed to fetch client details for update email: ${error.message}`);
						addedClientsInfo = addedClients.map((id) => ({ uid: id, name: `Client ${id}` }));
						removedClientsInfo = removedClients.map((id) => ({ uid: id, name: `Client ${id}` }));
					}
				}

				clientChanges = {
					added: addedClientsInfo,
					removed: removedClientsInfo,
					totalAssigned: updatedAssignedClients.length,
				};
			}

			const changesList = [];
			if (changes.role) changesList.push('Role/Access Level');
			if (changes.status) changesList.push('Account Status');
			if (changes.profile) changesList.push('Profile Information');
			if (changes.assignedClients) changesList.push('Client Assignments');

			const emailData = {
				userEmail: updatedUser.email,
				userName: `${updatedUser.name} ${updatedUser.surname}`,
				userFirstName: updatedUser.name,
				platformName: 'Loro CRM',
				loginUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za/sign-in',
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				organizationName: updatedUser.organisation?.name || 'Your Organization',
				branchName: updatedUser.branch?.name || 'Main Branch',
				dashboardUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za',
				changes: {
					role: changes.role,
					status: changes.status,
					profile: changes.profile,
					assignedClients: changes.assignedClients,
				},
				changesList,
				updateTime: new Date().toLocaleString(),
				roleChange: changes.role
					? {
							previousRole: originalUser.accessLevel,
							newRole: updatedUser.accessLevel,
					  }
					: null,
				statusChange: changes.status
					? {
							previousStatus: originalUser.status,
							newStatus: updatedUser.status,
					  }
					: null,
				clientChanges,
			};

			// Send email through event emitter
			this.eventEmitter.emit('send.email', EmailType.NEW_USER_ADMIN_NOTIFICATION, [updatedUser.email], emailData);

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`[EMAIL] Comprehensive update notification sent to: ${updatedUser.email} in ${executionTime}ms`,
			);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[EMAIL] Failed to send comprehensive update notification to ${updatedUser.email} after ${executionTime}ms: ${error.message}`,
			);
		}
	}

	/**
	 * Send user creation notification email to the new user (fallback template)
	 */
	private async sendUserCreationNotificationEmail(user: User): Promise<void> {
		const startTime = Date.now();
		this.logger.debug(`Preparing standard user creation email for: ${user.email} (${user.uid})`);

		try {
			const emailData = {
				userEmail: user.email,
				userName: `${user.name} ${user.surname}`,
				userFirstName: user.name,
				platformName: 'Loro CRM',
				loginUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za/sign-in',
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				organizationName: user.organisation?.name || 'Your Organization',
				branchName: user.branch?.name || 'Main Branch',
				dashboardUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za',
				accountDetails: {
					name: `${user.name} ${user.surname}`,
					email: user.email,
					username: user.username,
					role: user.accessLevel,
					branch: user.branch?.name,
				},
			};

			// Send email through event emitter
			this.eventEmitter.emit('send.email', EmailType.NEW_USER_WELCOME, [user.email], emailData);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[EMAIL] Standard user creation notification sent to: ${user.email} in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[EMAIL] Failed to send standard user creation notification to ${user.email} after ${executionTime}ms: ${error.message}`,
			);
		}
	}

	/**
	 * Send user creation notification email to the new user
	 */

	/**
	 * Send password update notification email
	 */
	private async sendPasswordUpdateNotificationEmail(user: User): Promise<void> {
		try {
			const emailData = {
				to: user.email,
				subject: 'Password Updated - Loro CRM',
				html: `
					<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
						<div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 30px; text-align: center;">
							<h1 style="color: white; margin: 0; font-size: 24px;">Password Updated</h1>
						</div>
						<div style="padding: 30px; background-color: #f8f9fa;">
							<h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name} ${user.surname},</h2>
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								Your password has been successfully updated for your Loro CRM account.
							</p>
							<div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
								<p style="margin: 0; color: #155724;">
									<strong>Password changed on:</strong> ${new Date().toLocaleString()}
								</p>
							</div>
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								If you did not make this change, please contact your administrator immediately or reach out to our support team.
							</p>
							<div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
								<p style="margin: 0; color: #856404;">
									<strong>Security Tip:</strong> Make sure to use a strong, unique password and never share it with anyone.
								</p>
							</div>
						</div>
						<div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
							<p>This is an automated security notification. Please do not reply to this email.</p>
							<p>&copy; ${new Date().getFullYear()} Loro CRM. All rights reserved.</p>
						</div>
					</div>
				`,
			};

			this.logger.log(`[EMAIL] Password update notification sent to: ${user.email}`);
		} catch (error) {
			this.logger.error(`[EMAIL] Failed to send password update notification to ${user.email}: ${error.message}`);
		}
	}

	/**
	 * Send role update notification email
	 */
	private async sendRoleUpdateNotificationEmail(user: User, previousRole: string, newRole: string): Promise<void> {
		try {
			const emailData = {
				to: user.email,
				subject: 'Your Role Has Been Updated - Loro CRM',
				html: `
					<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
						<div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); padding: 30px; text-align: center;">
							<h1 style="color: white; margin: 0; font-size: 24px;">Role Updated</h1>
						</div>
						<div style="padding: 30px; background-color: #f8f9fa;">
							<h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name} ${user.surname},</h2>
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								Your role in the Loro CRM system has been updated.
							</p>
							<div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
								<table style="width: 100%; border-collapse: collapse;">
									<tr style="border-bottom: 1px solid #eee;">
										<td style="padding: 10px 0; font-weight: bold; color: #333;">Previous Role:</td>
										<td style="padding: 10px 0; color: #dc3545;">${previousRole}</td>
									</tr>
									<tr>
										<td style="padding: 10px 0; font-weight: bold; color: #333;">New Role:</td>
										<td style="padding: 10px 0; color: #28a745;">${newRole}</td>
									</tr>
								</table>
							</div>
							<div style="background: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
								<p style="margin: 0; color: #0c5460;">
									<strong>Note:</strong> Your new role may grant you access to different features and permissions within the system. Please log in to explore your updated capabilities.
								</p>
							</div>
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								If you have any questions about your new role or need assistance, please contact your administrator or our support team.
							</p>
							<div style="text-align: center; margin-top: 30px;">
								<a href="${
									process.env.CLIENT_URL
								}/sign-in" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">Access Your Account</a>
							</div>
						</div>
						<div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
							<p>This is an automated notification. Please do not reply to this email.</p>
							<p>&copy; ${new Date().getFullYear()} Loro CRM. All rights reserved.</p>
						</div>
					</div>
				`,
			};

			this.logger.log(`[EMAIL] Role update notification sent to: ${user.email} (${previousRole} → ${newRole})`);
		} catch (error) {
			this.logger.error(`[EMAIL] Failed to send role update notification to ${user.email}: ${error.message}`);
		}
	}

	/**
	 * Send status update notification email
	 */
	private async sendStatusUpdateNotificationEmail(
		user: User,
		previousStatus: string,
		newStatus: string,
	): Promise<void> {
		try {
			const statusColors = {
				active: '#28a745',
				inactive: '#6c757d',
				suspended: '#dc3545',
				pending: '#ffc107',
				banned: '#dc3545',
				deleted: '#6c757d',
			};

			const emailData = {
				to: user.email,
				subject: 'Your Account Status Has Been Updated - Loro CRM',
				html: `
					<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
						<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
							<h1 style="color: white; margin: 0; font-size: 24px;">Account Status Updated</h1>
						</div>
						<div style="padding: 30px; background-color: #f8f9fa;">
							<h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name} ${user.surname},</h2>
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								Your account status in the Loro CRM system has been updated.
							</p>
							<div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
								<table style="width: 100%; border-collapse: collapse;">
									<tr style="border-bottom: 1px solid #eee;">
										<td style="padding: 10px 0; font-weight: bold; color: #333;">Previous Status:</td>
										<td style="padding: 10px 0; color: ${
											statusColors[previousStatus] || '#6c757d'
										}; text-transform: uppercase; font-weight: bold;">${previousStatus}</td>
									</tr>
									<tr>
										<td style="padding: 10px 0; font-weight: bold; color: #333;">New Status:</td>
										<td style="padding: 10px 0; color: ${
											statusColors[newStatus] || '#6c757d'
										}; text-transform: uppercase; font-weight: bold;">${newStatus}</td>
									</tr>
								</table>
							</div>
							${
								newStatus === 'active'
									? `
							<div style="background: #d4edda; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
								<p style="margin: 0; color: #155724;">
									<strong>Good news!</strong> Your account is now active and you have full access to the system.
								</p>
							</div>
							`
									: newStatus === 'suspended'
									? `
							<div style="background: #f8d7da; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
								<p style="margin: 0; color: #721c24;">
									<strong>Important:</strong> Your account has been suspended. Please contact your administrator for more information.
								</p>
							</div>
							`
									: `
							<div style="background: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
								<p style="margin: 0; color: #0c5460;">
									<strong>Status Change:</strong> Your account status has been updated. This may affect your access to certain features.
								</p>
							</div>
							`
							}
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								If you have any questions about this status change or need assistance, please contact your administrator or our support team.
							</p>
						</div>
						<div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
							<p>This is an automated notification. Please do not reply to this email.</p>
							<p>&copy; ${new Date().getFullYear()} Loro CRM. All rights reserved.</p>
						</div>
					</div>
				`,
			};

			this.logger.log(
				`[EMAIL] Status update notification sent to: ${user.email} (${previousStatus} → ${newStatus})`,
			);
		} catch (error) {
			this.logger.error(`[EMAIL] Failed to send status update notification to ${user.email}: ${error.message}`);
		}
	}

	/**
	 * Send profile update notification email
	 */
	private async sendProfileUpdateNotificationEmail(user: User): Promise<void> {
		try {
			const emailData = {
				to: user.email,
				subject: 'Your Profile Has Been Updated - Loro CRM',
				html: `
					<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
						<div style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); padding: 30px; text-align: center;">
							<h1 style="color: white; margin: 0; font-size: 24px;">Profile Updated</h1>
						</div>
						<div style="padding: 30px; background-color: #f8f9fa;">
							<h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name} ${user.surname},</h2>
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								Your profile information has been successfully updated in the Loro CRM system.
							</p>
							<div style="background: #d4edda; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
								<p style="margin: 0; color: #155724;">
									<strong>Update Time:</strong> ${new Date().toLocaleString()}
								</p>
							</div>
							<p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
								Your updated information is now active in the system. If you did not make these changes or if you notice any incorrect information, please contact your administrator immediately.
							</p>
							<div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
								<p style="margin: 0; color: #856404;">
									<strong>Security Note:</strong> For your security, we recommend reviewing your profile information periodically to ensure it remains accurate and up-to-date.
								</p>
							</div>
							<div style="text-align: center; margin-top: 30px;">
								<a href="${
									process.env.CLIENT_URL
								}/settings" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">View Your Profile</a>
							</div>
						</div>
						<div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
							<p>This is an automated notification. Please do not reply to this email.</p>
							<p>&copy; ${new Date().getFullYear()} Loro CRM. All rights reserved.</p>
						</div>
					</div>
				`,
			};

			this.logger.log(`[EMAIL] Profile update notification sent to: ${user.email}`);
		} catch (error) {
			this.logger.error(`[EMAIL] Failed to send profile update notification to ${user.email}: ${error.message}`);
		}
	}

	/**
	 * Send preference update notification email
	 */
	private async sendPreferenceUpdateNotificationEmail(user: User, updateUserPreferencesDto: any): Promise<void> {
		const startTime = Date.now();
		this.logger.debug(`Preparing preference update email for: ${user.email} (${user.uid})`);

		try {
			// Get the formatted update time in user's organization timezone
			const updateTime = await this.formatTimeInUserTimezone(new Date(), user, 'PPPp');

			// Format the updated preferences for display (for template)
			const formatPreferenceChanges = (changes: any) => {
				const friendlyNames: { [key: string]: string } = {
					theme: 'Theme',
					language: 'Language',
					notifications: 'Notifications',
					shiftAutoEnd: 'Auto-End Shift',
					notificationFrequency: 'Notification Frequency',
					dateFormat: 'Date Format',
					timeFormat: 'Time Format',
					emailNotifications: 'Email Notifications',
					smsNotifications: 'SMS Notifications',
					biometricAuth: 'Biometric Authentication',
					advancedFeatures: 'Advanced Features',
					timezone: 'Timezone',
				};

				return Object.entries(changes).map(([key, value]) => ({
					displayName: friendlyNames[key] || key,
					displayValue: typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : String(value)
				}));
			};

			const emailData = {
				userEmail: user.email,
				userName: `${user.name} ${user.surname}`,
				userFirstName: user.name,
				platformName: 'Loro CRM',
				loginUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za/sign-in',
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				organizationName: user.organisation?.name || 'Your Organization',
				branchName: user.branch?.name || 'Main Branch',
				dashboardUrl: process.env.CLIENT_URL || 'https://dashboard.loro.co.za',
				settingsUrl: `${process.env.CLIENT_URL || 'https://dashboard.loro.co.za'}/settings`,
				updateTime,
				preferenceChanges: formatPreferenceChanges(updateUserPreferencesDto),
			};

			// Send email using proper EmailType enum (following attendance service pattern)
			this.eventEmitter.emit('send.email', EmailType.USER_PREFERENCES_UPDATED, [user.email], emailData);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[EMAIL] Preference update notification sent to: ${user.email} in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[EMAIL] Failed to send preference update notification to ${user.email} after ${executionTime}ms: ${error.message}`,
			);
		}
	}

	/**
	 * Update device registration information for push notifications
	 * Ensures token uniqueness to prevent notifications from being sent to wrong users
	 */
	async updateDeviceRegistration(
		userId: number,
		deviceData: {
			expoPushToken: string;
			deviceId?: string;
			platform?: string;
			pushTokenUpdatedAt?: Date;
		}
	): Promise<void> {
		try {
			this.logger.debug(`Updating device registration for user: ${userId}`, {
				hasToken: !!deviceData.expoPushToken,
				tokenPrefix: deviceData.expoPushToken ? deviceData.expoPushToken.substring(0, 30) + '...' : 'null',
				deviceId: deviceData.deviceId,
				platform: deviceData.platform,
			});

			// CRITICAL FIX: Ensure token uniqueness before assignment
			// Find and clear this token from any other users
			if (deviceData.expoPushToken) {
				const usersWithToken = await this.userRepository.find({
					where: { 
						expoPushToken: deviceData.expoPushToken,
						uid: Not(userId) 
					},
					select: ['uid', 'email', 'name', 'surname']
				});

				if (usersWithToken.length > 0) {
					this.logger.warn(`🔴 [UserService] [TokenConflict] Detected ${usersWithToken.length} users with duplicate token`, {
						token: deviceData.expoPushToken.substring(0, 30) + '...',
						currentUserId: userId,
						conflictingUserIds: usersWithToken.map(u => u.uid),
						conflictingUserEmails: usersWithToken.map(u => u.email),
					});

					// Clear the token from all conflicting users
					await this.userRepository.update(
						{ expoPushToken: deviceData.expoPushToken, uid: Not(userId) },
						{ 
							expoPushToken: null, 
							deviceId: null, 
							platform: null, 
							pushTokenUpdatedAt: null 
						}
					);

					this.logger.log(`✅ [UserService] [TokenConflict] Cleared duplicate token from ${usersWithToken.length} users`, {
						clearedUsers: usersWithToken.map(u => ({
							uid: u.uid,
							email: u.email,
							name: `${u.name || ''} ${u.surname || ''}`.trim()
						})),
						newOwnerUserId: userId
					});
				} else {
					this.logger.debug(`✅ [UserService] [TokenUniqueness] No duplicate tokens found - token is unique`, {
						token: deviceData.expoPushToken.substring(0, 30) + '...',
						userId
					});
				}
			}

			// Now update the current user's token
			const updateResult = await this.userRepository.update(userId, {
				expoPushToken: deviceData.expoPushToken,
				deviceId: deviceData.deviceId,
				platform: deviceData.platform,
				pushTokenUpdatedAt: deviceData.pushTokenUpdatedAt || new Date(),
			});

			if (updateResult.affected === 0) {
				throw new Error(`No user found with ID: ${userId}`);
			}

			this.logger.log(`✅ Successfully updated device registration for user: ${userId}`);

			// Clear user cache to ensure fresh data
			await this.invalidateUserCache({ uid: userId } as User);

		} catch (error) {
			this.logger.error(`Failed to update device registration for user ${userId}:`, error);
			throw error;
		}
	}

	// ======================================================
	// USER PREFERENCES MANAGEMENT METHODS
	// ======================================================

	/**
	 * Get user preferences
	 */
	async getUserPreferences(
		userId: string,
		accessScope: { orgId?: number; branchId?: number; isElevated: boolean },
	): Promise<{ preferences: any; message: string }> {
		const operationId = `getUserPreferences_${userId}_${Date.now()}`;
		
		this.logger.log(`🔍 [${operationId}] Starting get user preferences operation`, {
			userId,
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				isElevated: accessScope.isElevated,
			},
			timestamp: new Date().toISOString(),
		});

		try {
			this.logger.debug(`📋 [${operationId}] Building user query with access control`, {
				userId,
				isElevated: accessScope.isElevated,
				orgScope: accessScope.orgId,
				branchScope: accessScope.branchId,
			});

			// Find the user with access control (userId: string – clerk id or numeric)
			const userWhere = typeof userId === 'string' && userId.startsWith('user_')
				? { clerkUserId: userId, isDeleted: false }
				: { uid: Number(userId), isDeleted: false };
			const user = await this.userRepository.findOne({
				where: {
					...userWhere,
					...(accessScope.isElevated
						? {}
						: {
								organisation: { uid: accessScope.orgId },
								...(accessScope.branchId ? { branch: { uid: accessScope.branchId } } : {}),
						  }),
				},
			});

			if (!user) {
				this.logger.warn(`❌ [${operationId}] User not found or access denied`, {
					userId,
					accessScope,
					isElevated: accessScope.isElevated,
				});
				throw new NotFoundException(`User with ID ${userId} not found or access denied`);
			}

			this.logger.debug(`👤 [${operationId}] User found, retrieving preferences`, {
				userId: user.uid,
				username: user.username,
				email: user.email,
				hasExistingPreferences: !!user.preferences,
				preferenceKeys: user.preferences ? Object.keys(user.preferences) : [],
			});

			// Return user preferences or defaults
			const preferences = user.preferences || this.getDefaultPreferences();
			const isUsingDefaults = !user.preferences;

			this.logger.log(`✅ [${operationId}] Successfully retrieved preferences for user: ${userId}`, {
				userId,
				username: user.username,
				email: user.email,
				isUsingDefaults,
				preferenceCount: Object.keys(preferences).length,
				preferences: {
					theme: preferences.theme,
					language: preferences.language,
					notifications: preferences.notifications,
					timezone: preferences.timezone,
				},
				operation: 'getUserPreferences',
				duration: `${Date.now() - parseInt(operationId.split('_')[2])}ms`,
			});

			return {
				preferences,
				message: 'User preferences retrieved successfully',
			};
		} catch (error) {
			this.logger.error(`❌ [${operationId}] Failed to get preferences for user ${userId}`, {
				userId,
				accessScope,
				error: error.message,
				stack: error.stack,
				operation: 'getUserPreferences',
				duration: `${Date.now() - parseInt(operationId.split('_')[2])}ms`,
			});
			throw error;
		}
	}

	/**
	 * Create user preferences
	 */
	async createUserPreferences(
		userId: string,
		createUserPreferencesDto: CreateUserPreferencesDto,
		accessScope: { orgId?: number; branchId?: number; isElevated: boolean },
	): Promise<{ message: string }> {
		const operationId = `createUserPreferences_${userId}_${Date.now()}`;
		
		this.logger.log(`🆕 [${operationId}] Starting create user preferences operation`, {
			userId,
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				isElevated: accessScope.isElevated,
			},
			incomingPreferences: createUserPreferencesDto,
			timestamp: new Date().toISOString(),
		});

		try {
			this.logger.debug(`📋 [${operationId}] Validating user access and preferences data`, {
				userId,
				isElevated: accessScope.isElevated,
				preferenceKeys: Object.keys(createUserPreferencesDto),
				preferenceCount: Object.keys(createUserPreferencesDto).length,
			});

			// Find the user with access control - use clerkUserId if it's a Clerk ID, otherwise use uid
			const whereCondition: any = {
				isDeleted: false,
				...(accessScope.isElevated
					? {}
					: {
							organisation: { uid: accessScope.orgId },
							...(accessScope.branchId ? { branch: { uid: accessScope.branchId } } : {}),
					  }),
			};
			
			if (userId.startsWith('user_')) {
				whereCondition.clerkUserId = userId;
			} else {
				whereCondition.uid = userId;
			}
			
			const user = await this.userRepository.findOne({
				where: whereCondition,
			});

			if (!user) {
				this.logger.warn(`❌ [${operationId}] User not found or access denied for preference creation`, {
					userId,
					accessScope,
					isElevated: accessScope.isElevated,
				});
				throw new NotFoundException(`User with ID ${userId} not found or access denied`);
			}

			this.logger.debug(`👤 [${operationId}] User found, preparing preference data`, {
				userId: user.uid,
				username: user.username,
				email: user.email,
				hasExistingPreferences: !!user.preferences,
				existingPreferenceKeys: user.preferences ? Object.keys(user.preferences) : [],
			});

			// Merge with defaults and validate
			const defaultPreferences = this.getDefaultPreferences();
			const newPreferences = { ...defaultPreferences, ...createUserPreferencesDto };

			this.logger.debug(`🔧 [${operationId}] Merging preferences with defaults`, {
				defaultKeys: Object.keys(defaultPreferences),
				incomingKeys: Object.keys(createUserPreferencesDto),
				finalKeys: Object.keys(newPreferences),
				finalPreferences: {
					theme: newPreferences.theme,
					language: newPreferences.language,
					notifications: newPreferences.notifications,
					timezone: newPreferences.timezone,
				},
			});

			// Update user preferences
			const updateResult = await this.userRepository.update(userId, {
				preferences: newPreferences,
			});

			if (updateResult.affected === 0) {
				this.logger.error(`❌ [${operationId}] No rows affected during preference update`, {
					userId,
					updateResult,
				});
				throw new Error(`Failed to update preferences for user ${userId}`);
			}

			this.logger.log(`✅ [${operationId}] Successfully created preferences for user: ${userId}`, {
				userId,
				username: user.username,
				email: user.email,
				preferencesCreated: Object.keys(newPreferences).length,
				affectedRows: updateResult.affected,
				operation: 'createUserPreferences',
				duration: `${Date.now() - parseInt(operationId.split('_')[2])}ms`,
			});

			// Clear user cache
			await this.invalidateUserCache(user);
			this.logger.debug(`🗑️ [${operationId}] User cache invalidated for user: ${userId}`);

			return {
				message: 'User preferences created successfully',
			};
		} catch (error) {
			this.logger.error(`❌ [${operationId}] Failed to create preferences for user ${userId}`, {
				userId,
				accessScope,
				incomingPreferences: createUserPreferencesDto,
				error: error.message,
				stack: error.stack,
				operation: 'createUserPreferences',
				duration: `${Date.now() - parseInt(operationId.split('_')[2])}ms`,
			});
			throw error;
		}
	}

	/**
	 * Update user preferences
	 */
	async updateUserPreferences(
		userId: string,
		updateUserPreferencesDto: UpdateUserPreferencesDto,
		accessScope: { orgId?: number; branchId?: number; isElevated: boolean },
	): Promise<{ message: string }> {
		const operationId = `updateUserPreferences_${userId}_${Date.now()}`;
		
		this.logger.log(`🔄 [${operationId}] Updating user preferences`, {
			userId,
			updateKeys: Object.keys(updateUserPreferencesDto),
		});

		try {
			// Find the user with access control and load organization relation for timezone
			// Use clerkUserId if it's a Clerk ID, otherwise use uid
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where(
					userId.startsWith('user_')
						? 'user.clerkUserId = :userId'
						: 'user.uid = :userId',
					{ userId }
				)
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

			if (accessScope.orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: accessScope.orgId });
			}

			if (accessScope.branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId: accessScope.branchId });
			}

			const user = await queryBuilder.getOne();

			if (!user) {
				this.logger.warn(`❌ [${operationId}] User not found or access denied for preference update`, {
					userId,
					accessScope,
				});
				throw new NotFoundException(`User with ID ${userId} not found or access denied`);
			}

			// Get current preferences or defaults
			const currentPreferences = user.preferences || this.getDefaultPreferences();
			const previousPreferences = { ...currentPreferences };

			// Merge with existing preferences
			const updatedPreferences = { ...currentPreferences, ...updateUserPreferencesDto };

			// Update user preferences
			const updateResult = await this.userRepository.update(userId, {
				preferences: updatedPreferences,
			});

			if (updateResult.affected === 0) {
				this.logger.error(`❌ [${operationId}] No rows affected during preference update`, {
					userId,
				});
				throw new Error(`Failed to update preferences for user ${userId}`);
			}

			// Clear user cache
			await this.invalidateUserCache(user);

			// Emit events for notifications and email
			this.eventEmitter.emit('user.preferences.updated', {
				userId: user.uid,
				userEmail: user.email,
				userName: `${user.name} ${user.surname}`,
				previousPreferences,
				updatedPreferences,
				changedKeys: Object.keys(updateUserPreferencesDto),
				timestamp: new Date(),
			});

			// Send preference update notification email
			await this.sendPreferenceUpdateNotificationEmail(user, updateUserPreferencesDto);

			this.logger.log(`✅ [${operationId}] Successfully updated preferences for user: ${userId}`, {
				userId,
				updatedKeys: Object.keys(updateUserPreferencesDto),
				affectedRows: updateResult.affected,
			});

			return {
				message: 'User preferences updated successfully',
			};
		} catch (error) {
			this.logger.error(`❌ [${operationId}] Failed to update preferences for user ${userId}`, {
				userId,
				error: error.message,
			});
			throw error;
		}
	}

	/**
	 * Get default user preferences
	 */
	private getDefaultPreferences(): any {
		const defaults = {
			theme: 'light',
			language: 'en',
			notifications: true,
			shiftAutoEnd: false,
			notificationFrequency: 'real_time',
			dateFormat: 'DD/MM/YYYY',
			timeFormat: '24h',
			emailNotifications: true,
			smsNotifications: false,
			biometricAuth: false,
			advancedFeatures: false,
			timezone: 'Africa/Johannesburg',
		};

		this.logger.debug('🔧 Returning default user preferences', {
			defaultKeys: Object.keys(defaults),
			defaultCount: Object.keys(defaults).length,
			defaults: {
				theme: defaults.theme,
				language: defaults.language,
				notifications: defaults.notifications,
				timezone: defaults.timezone,
			},
		});

		return defaults;
	}

	/**
	 * 🔄 RECURRING TARGETS: Cron job to process target recurrence
	 * Runs daily at 00:05 AM (5 minutes past midnight) to process any targets due for recurrence
	 */
	@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
	async processRecurringTargets(): Promise<void> {
		this.logger.log('🔄 Starting recurring targets processing...');
		const startTime = Date.now();
		
		try {
			const now = new Date();
			
			// Find all recurring targets where nextRecurrenceDate has passed
			const targetsToRecur = await this.userTargetRepository
				.createQueryBuilder('target')
				.leftJoinAndSelect('target.user', 'user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('target.isRecurring = :isRecurring', { isRecurring: true })
				.andWhere('target.nextRecurrenceDate <= :now', { now })
				.getMany();
			
			this.logger.log(`Found ${targetsToRecur.length} targets ready for recurrence`);
			
			if (targetsToRecur.length === 0) {
				this.logger.log('✅ No targets to process');
				return;
			}
			
			let successCount = 0;
			let errorCount = 0;
			
			// Process each target
			for (const target of targetsToRecur) {
				try {
					await this.recurSingleTarget(target);
					successCount++;
				} catch (error) {
					errorCount++;
					this.logger.error(
						`Failed to recur target for user ${target.user?.uid}: ${error.message}`,
						error.stack
					);
				}
			}
			
			const duration = Date.now() - startTime;
			this.logger.log(
				`✅ Recurring targets processing completed in ${duration}ms - ` +
				`Success: ${successCount}, Errors: ${errorCount}`
			);
			
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ Error processing recurring targets after ${duration}ms: ${error.message}`,
				error.stack
			);
		}
	}

	/**
	 * Process recurrence for a single target
	 */
	private async recurSingleTarget(target: UserTarget): Promise<void> {
		this.logger.log(`Processing recurrence for user ${target.user?.uid} - Target ${target.uid}`);
		
		// 1️⃣ Archive current period to history
		// Fix: Use period end date instead of current date for accurate month tracking
		const periodEndDate = target.periodEndDate || new Date();
		const historyEntry = {
			date: format(periodEndDate, 'yyyy-MM'),
			targetSalesAmount: target.targetSalesAmount,
			achievedSalesAmount: target.currentSalesAmount,
			targetQuotationsAmount: target.targetQuotationsAmount,
			achievedQuotationsAmount: target.currentQuotationsAmount,
			targetNewClients: target.targetNewClients,
			achievedNewClients: target.currentNewClients,
			targetNewLeads: target.targetNewLeads,
			achievedNewLeads: target.currentNewLeads,
			targetCheckIns: target.targetCheckIns,
			achievedCheckIns: target.currentCheckIns,
			targetCalls: target.targetCalls,
			achievedCalls: target.currentCalls,
			targetHoursWorked: target.targetHoursWorked,
			achievedHoursWorked: target.currentHoursWorked,
			missingAmount: Math.max(0, (target.targetSalesAmount || 0) - (target.currentSalesAmount || 0)),
			completionPercentage: this.calculateCompletionPercentage(target),
			status: this.determineCompletionStatus(target),
			lastUpdated: new Date().toISOString()
		};
		
		const history = target.history || [];
		history.push(historyEntry);
		
		// 2️⃣ Calculate carry forward amounts if enabled
		let carryForwardAmounts = {};
		if (target.carryForwardUnfulfilled) {
			carryForwardAmounts = this.calculateCarryForward(target);
			this.logger.debug(`Carry forward amounts:`, carryForwardAmounts);
		}
		
		// 3️⃣ Reset current values
		target.currentSalesAmount = 0;
		target.currentQuotationsAmount = 0;
		target.currentOrdersAmount = 0;
		target.currentHoursWorked = 0;
		target.currentNewClients = 0;
		target.currentNewLeads = 0;
		target.currentCheckIns = 0;
		target.currentCalls = 0;
		
		// 4️⃣ Apply carry forward to targets if enabled
		if (target.carryForwardUnfulfilled && Object.keys(carryForwardAmounts).length > 0) {
			target.targetSalesAmount = (target.targetSalesAmount || 0) + (carryForwardAmounts['salesAmount'] || 0);
			target.targetQuotationsAmount = (target.targetQuotationsAmount || 0) + (carryForwardAmounts['quotationsAmount'] || 0);
			target.targetNewClients = (target.targetNewClients || 0) + (carryForwardAmounts['newClients'] || 0);
			target.targetNewLeads = (target.targetNewLeads || 0) + (carryForwardAmounts['newLeads'] || 0);
			target.targetCheckIns = (target.targetCheckIns || 0) + (carryForwardAmounts['checkIns'] || 0);
			target.targetCalls = (target.targetCalls || 0) + (carryForwardAmounts['calls'] || 0);
			target.targetHoursWorked = (target.targetHoursWorked || 0) + (carryForwardAmounts['hoursWorked'] || 0);
		}
		
		// 5️⃣ Update period dates
		const oldEndDate = target.periodEndDate;
		
		target.periodStartDate = this.calculateNextPeriodStart(oldEndDate, target.recurringInterval);
		target.periodEndDate = this.calculateNextPeriodEnd(target.periodStartDate, target.recurringInterval);
		
		// Fix: Update targetPeriod to reflect the new month (e.g., "2024-12" for December)
		target.targetPeriod = format(target.periodStartDate, 'yyyy-MM');
		
		// 6️⃣ Update recurrence metadata
		target.lastRecurrenceDate = new Date();
		target.nextRecurrenceDate = this.calculateNextRecurrenceDate(
			target.periodEndDate,
			target.recurringInterval
		);
		target.recurrenceCount = (target.recurrenceCount || 0) + 1;
		target.lastCalculatedAt = new Date();
		target.history = history;
		
		// 7️⃣ Save updated target
		await this.userTargetRepository.save(target);
		
		// 8️⃣ Invalidate cache
		if (target.user?.uid) {
			await this.cacheManager.del(this.getCacheKey(`target_${target.user.uid}`));
		}
		
		this.logger.log(
			`✅ Target recurred for user ${target.user?.uid} - ` +
			`Period: ${format(target.periodStartDate, 'yyyy-MM-dd')} to ${format(target.periodEndDate, 'yyyy-MM-dd')} ` +
			`(Recurrence #${target.recurrenceCount})`
		);
		
		// 9️⃣ Send notification to user
		await this.notifyUserOfNewPeriod(target);
	}

	/**
	 * Calculate the next recurrence date based on end date and interval
	 */
	private calculateNextRecurrenceDate(currentEndDate: Date, interval: 'daily' | 'weekly' | 'monthly'): Date {
		const endDate = new Date(currentEndDate);
		
		switch (interval) {
			case 'daily':
				return addDays(endDate, 1);
			case 'weekly':
				return addDays(endDate, 7);
			case 'monthly':
				// Fix: For monthly intervals, trigger on the first day of the next month
				// This ensures Nov->Dec transition happens on Dec 1st, not after period ends
				const nextMonth = addMonths(endDate, 1);
				return startOfMonth(nextMonth);
			default:
				throw new Error(`Invalid recurring interval: ${interval}`);
		}
	}

	/**
	 * Calculate the start date for the next period
	 */
	private calculateNextPeriodStart(previousEndDate: Date, interval: string): Date {
		const nextStart = new Date(previousEndDate);
		nextStart.setDate(nextStart.getDate() + 1);
		nextStart.setHours(0, 0, 0, 0);
		return nextStart;
	}

	/**
	 * Calculate the end date for the next period
	 */
	private calculateNextPeriodEnd(startDate: Date, interval: 'daily' | 'weekly' | 'monthly'): Date {
		const start = new Date(startDate);
		let endDate: Date;
		
		switch (interval) {
			case 'daily':
				endDate = addDays(start, 1);
				break;
			case 'weekly':
				endDate = addDays(start, 7);
				break;
			case 'monthly':
				endDate = addMonths(start, 1);
				break;
			default:
				throw new Error(`Invalid recurring interval: ${interval}`);
		}
		
		// End date is inclusive (last day of period)
		endDate.setDate(endDate.getDate() - 1);
		endDate.setHours(23, 59, 59, 999);
		return endDate;
	}

	/**
	 * Calculate completion percentage for a target
	 */
	private calculateCompletionPercentage(target: UserTarget): number {
		const metrics: { target: number; current: number }[] = [];
		
		if (target.targetSalesAmount > 0) {
			metrics.push({ target: target.targetSalesAmount, current: target.currentSalesAmount || 0 });
		}
		if (target.targetQuotationsAmount > 0) {
			metrics.push({ target: target.targetQuotationsAmount, current: target.currentQuotationsAmount || 0 });
		}
		if (target.targetNewClients > 0) {
			metrics.push({ target: target.targetNewClients, current: target.currentNewClients || 0 });
		}
		if (target.targetNewLeads > 0) {
			metrics.push({ target: target.targetNewLeads, current: target.currentNewLeads || 0 });
		}
		if (target.targetCheckIns > 0) {
			metrics.push({ target: target.targetCheckIns, current: target.currentCheckIns || 0 });
		}
		if (target.targetCalls > 0) {
			metrics.push({ target: target.targetCalls, current: target.currentCalls || 0 });
		}
		if (target.targetHoursWorked > 0) {
			metrics.push({ target: target.targetHoursWorked, current: target.currentHoursWorked || 0 });
		}
		
		if (metrics.length === 0) {
			return 0;
		}
		
		const totalPercentage = metrics.reduce((sum, metric) => {
			const percentage = Math.min((metric.current / metric.target) * 100, 100);
			return sum + percentage;
		}, 0);
		
		return Math.round(totalPercentage / metrics.length);
	}

	/**
	 * Determine completion status based on percentage
	 */
	private determineCompletionStatus(target: UserTarget): 'achieved' | 'partial' | 'missed' {
		const completion = this.calculateCompletionPercentage(target);
		
		if (completion >= 100) return 'achieved';
		if (completion >= 50) return 'partial';
		return 'missed';
	}

	/**
	 * Calculate amounts to carry forward to next period
	 */
	private calculateCarryForward(target: UserTarget): Record<string, number> {
		const carryForward: Record<string, number> = {};
		
		if (target.targetSalesAmount && target.currentSalesAmount < target.targetSalesAmount) {
			carryForward.salesAmount = target.targetSalesAmount - target.currentSalesAmount;
		}
		
		if (target.targetQuotationsAmount && target.currentQuotationsAmount < target.targetQuotationsAmount) {
			carryForward.quotationsAmount = target.targetQuotationsAmount - target.currentQuotationsAmount;
		}
		
		if (target.targetNewClients && target.currentNewClients < target.targetNewClients) {
			carryForward.newClients = target.targetNewClients - target.currentNewClients;
		}
		
		if (target.targetNewLeads && target.currentNewLeads < target.targetNewLeads) {
			carryForward.newLeads = target.targetNewLeads - target.currentNewLeads;
		}
		
		if (target.targetCheckIns && target.currentCheckIns < target.targetCheckIns) {
			carryForward.checkIns = target.targetCheckIns - target.currentCheckIns;
		}
		
		if (target.targetCalls && target.currentCalls < target.targetCalls) {
			carryForward.calls = target.targetCalls - target.currentCalls;
		}
		
		if (target.targetHoursWorked && target.currentHoursWorked < target.targetHoursWorked) {
			carryForward.hoursWorked = target.targetHoursWorked - target.currentHoursWorked;
		}
		
		return carryForward;
	}

	/**
	 * Send notification to user about new target period
	 */
	private async notifyUserOfNewPeriod(target: UserTarget): Promise<void> {
		if (!target.user?.uid) {
			this.logger.warn('Cannot send notification: user not loaded');
			return;
		}
		
		try {
			// Send push notification
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.USER_TARGET_UPDATED,
				[target.user.uid],
				{
					message: `🔄 New target period started! Your targets have been reset. ${
						target.carryForwardUnfulfilled ? 'Unfulfilled targets have been carried forward.' : ''
					}`,
					userName: `${target.user.name} ${target.user.surname}`.trim(),
					periodStartDate: format(target.periodStartDate, 'yyyy-MM-dd'),
					periodEndDate: format(target.periodEndDate, 'yyyy-MM-dd'),
					recurringInterval: target.recurringInterval,
					recurrenceCount: target.recurrenceCount,
					timestamp: new Date().toISOString(),
				},
				{
					priority: NotificationPriority.HIGH,
				},
			);
			
			this.logger.debug(`Recurrence notification sent to user: ${target.user.uid}`);
		} catch (error) {
			this.logger.error(
				`Failed to send recurrence notification to user ${target.user.uid}: ${error.message}`
			);
		}
	}
}
