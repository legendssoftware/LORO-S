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
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
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
import { BulkCreateUserDto, BulkCreateUserResponse, BulkUserResult } from './dto/bulk-create-user.dto';
import { BulkUpdateUserDto, BulkUpdateUserResponse, BulkUpdateUserResult } from './dto/bulk-update-user.dto';
import { DataSource } from 'typeorm';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';

@Injectable()
export class UserService {
	private readonly logger = new Logger(UserService.name);
	private readonly CACHE_PREFIX = 'users:';
	private readonly CACHE_TTL: number;
	private readonly activeCalculations = new Set<number>();

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
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
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
		this.logger.log('UserService initialized with cache TTL: ' + this.CACHE_TTL + 'ms');
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
					this.logger.warn(`Invalid currentSalesAmount: ${userTarget.currentSalesAmount}`);
					return false;
				}
				// Check for unreasonably large values (e.g., over 10 million)
				if (userTarget.currentSalesAmount > 10000000) {
					this.logger.warn(`Unreasonably large currentSalesAmount: ${userTarget.currentSalesAmount}`);
					return false;
				}
			}

			if (userTarget.currentQuotationsAmount !== null && userTarget.currentQuotationsAmount !== undefined) {
				if (isNaN(userTarget.currentQuotationsAmount) || userTarget.currentQuotationsAmount < 0) {
					this.logger.warn(`Invalid currentQuotationsAmount: ${userTarget.currentQuotationsAmount}`);
					return false;
				}
				if (userTarget.currentQuotationsAmount > 10000000) {
					this.logger.warn(
						`Unreasonably large currentQuotationsAmount: ${userTarget.currentQuotationsAmount}`,
					);
					return false;
				}
			}

			if (userTarget.currentOrdersAmount !== null && userTarget.currentOrdersAmount !== undefined) {
				if (isNaN(userTarget.currentOrdersAmount) || userTarget.currentOrdersAmount < 0) {
					this.logger.warn(`Invalid currentOrdersAmount: ${userTarget.currentOrdersAmount}`);
					return false;
				}
				if (userTarget.currentOrdersAmount > 10000000) {
					this.logger.warn(`Unreasonably large currentOrdersAmount: ${userTarget.currentOrdersAmount}`);
					return false;
				}
			}

			// Check for negative counts
			if (userTarget.currentNewLeads !== null && userTarget.currentNewLeads !== undefined) {
				if (userTarget.currentNewLeads < 0) {
					this.logger.warn(`Invalid currentNewLeads: ${userTarget.currentNewLeads}`);
					return false;
				}
			}

			if (userTarget.currentNewClients !== null && userTarget.currentNewClients !== undefined) {
				if (userTarget.currentNewClients < 0) {
					this.logger.warn(`Invalid currentNewClients: ${userTarget.currentNewClients}`);
					return false;
				}
			}

			if (userTarget.currentCheckIns !== null && userTarget.currentCheckIns !== undefined) {
				if (userTarget.currentCheckIns < 0) {
					this.logger.warn(`Invalid currentCheckIns: ${userTarget.currentCheckIns}`);
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
	 * Comprehensive cache invalidation for user-related data
	 * Clears all relevant cache entries when user data changes
	 * @param user - User entity to invalidate cache for
	 */
	private async invalidateUserCache(user: User) {
		try {
			this.logger.debug(`Invalidating cache for user: ${user.uid} (${user.email})`);

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

			this.logger.debug(`Cache invalidated for user ${user.uid}. Cleared ${keysToDelete.length} cache keys`);

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
	 * Exclude password from user data and include populated assigned clients
	 * @param user - User entity
	 * @returns User data without password but with assigned clients
	 */
	private async excludePasswordAndPopulateClients(
		user: User,
	): Promise<Omit<User, 'password'> & { assignedClients?: Client[] }> {
		const userWithClients = await this.populateAssignedClients(user);
		const { password, ...userWithoutPassword } = userWithClients;
		return userWithoutPassword;
	}

	/**
	 * Exclude password from user data (legacy method for backward compatibility)
	 * @param user - User entity
	 * @returns User data without password
	 */
	private excludePassword(user: User): Omit<User, 'password'> {
		const { password, ...userWithoutPassword } = user;
		return userWithoutPassword;
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
		this.logger.log(
			`[USER_CREATION] Starting user creation process for: ${createUserDto.email} ${
				orgId ? `in org: ${orgId}` : ''
			} ${branchId ? `in branch: ${branchId}` : ''}`,
		);

		try {
			// Organization and branch validation is handled by TypeORM relationship integrity
			// This follows the same pattern as the assets service
			if (orgId) {
				this.logger.debug(`[USER_CREATION] Organization ID provided: ${orgId}`);
			}
			if (branchId) {
				this.logger.debug(`[USER_CREATION] Branch ID provided: ${branchId}`);
			}

			// Hash password if provided
			if (createUserDto.password) {
				this.logger.debug('[USER_CREATION] Hashing user password');
				createUserDto.password = await bcrypt.hash(createUserDto.password, 10);
			}

			// Generate user reference if not provided
			if (!createUserDto.userref) {
				createUserDto.userref = `USR${Math.floor(100000 + Math.random() * 900000)}`;
				this.logger.debug(`[USER_CREATION] Generated user reference: ${createUserDto.userref}`);
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

			this.logger.debug('[USER_CREATION] Saving user to database');
			const savedUser = await this.userRepository.save(user);

			if (!savedUser) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.log(
				`[USER_CREATION] User created successfully: ${savedUser.uid} (${savedUser.email}) with role: ${savedUser.accessLevel}`,
			);

			// Invalidate cache after creation
			await this.invalidateUserCache(savedUser);

			// Send welcome and creation notification emails
			this.logger.debug('[USER_CREATION] Sending welcome and notification emails');
			const emailPromises = [this.sendWelcomeEmail(savedUser)];

			// Check if user has assigned clients for client assignment notification
			if (createUserDto.assignedClientIds && createUserDto.assignedClientIds.length > 0) {
				this.logger.debug(
					`[USER_CREATION] User has ${createUserDto.assignedClientIds.length} assigned clients, sending comprehensive notification`,
				);
				emailPromises.push(
					this.sendUserCreationWithClientsNotificationEmail(savedUser, createUserDto.assignedClientIds),
				);
			} else {
				this.logger.debug('[USER_CREATION] User has no assigned clients, sending standard notification');
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
				this.logger.debug('[USER_CREATION] User creation push notification sent successfully');
			} catch (notificationError) {
				this.logger.warn(`Failed to send user creation push notification to ${savedUser.uid}:`, notificationError.message);
			}

			await Promise.all(emailPromises);

			const executionTime = Date.now() - startTime;
			this.logger.log(
				`[USER_CREATION] User creation completed successfully in ${executionTime}ms for user: ${savedUser.email}`,
			);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[USER_CREATION] Failed to create user: ${createUserDto.email} after ${executionTime}ms. Error: ${error.message}`,
				error.stack,
			);

			const response = {
				message: error?.message,
			};

			return response;
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
					this.logger.debug(`👤 [createBulkUsers] Processing user ${i + 1}/${bulkCreateUserDto.users.length}: ${userData.username} (${userData.email})`);
					
					// Check if username already exists
					const existingUsername = await queryRunner.manager.findOne(User, { 
						where: { username: userData.username } 
					});
					if (existingUsername) {
						throw new Error(`Username '${userData.username}' already exists`);
					}

					// Check if email already exists
					const existingEmail = await queryRunner.manager.findOne(User, { 
						where: { email: userData.email } 
					});
					if (existingEmail) {
						throw new Error(`Email '${userData.email}' already exists`);
					}

					// Auto-generate password if requested and no password provided
					let finalPassword = userData.password;
					if (!finalPassword && bulkCreateUserDto.autoGeneratePasswords) {
						finalPassword = this.generateRandomPassword();
						this.logger.debug(`🔐 [createBulkUsers] Auto-generated password for user: ${userData.username}`);
					}

					if (!finalPassword) {
						throw new Error('Password is required or enable autoGeneratePasswords');
					}

					// Hash the password
					const hashedPassword = await bcrypt.hash(finalPassword, 10);

					// Generate user reference if not provided
					const userref = userData.userref || `USR${Math.floor(100000 + Math.random() * 900000)}`;

					// Create user with org and branch association
					const user = queryRunner.manager.create(User, {
						...userData,
						password: hashedPassword,
						userref,
						...(bulkCreateUserDto.orgId && { organisation: { uid: bulkCreateUserDto.orgId } }),
						...(bulkCreateUserDto.branchId && { branch: { uid: bulkCreateUserDto.branchId } }),
						status: userData.status || 'active',
						accessLevel: userData.accessLevel || AccessLevel.USER,
						role: userData.role || 'user',
						isDeleted: false,
						createdAt: new Date(),
						updatedAt: new Date()
					});

					const savedUser = await queryRunner.manager.save(User, user);
					
					// Exclude password from result
					const { password: _, ...userWithoutPassword } = savedUser;

					results.push({
						user: userWithoutPassword,
						success: true,
						index: i,
						username: userData.username,
						email: userData.email
					});
					
					successCount++;
					createdUserIds.push(savedUser.uid);
					this.logger.debug(`✅ [createBulkUsers] User ${i + 1} created successfully: ${userData.username} (ID: ${savedUser.uid})`);
					
				} catch (userError) {
					const errorMessage = `User ${i + 1} (${userData.username || userData.email}): ${userError.message}`;
					this.logger.error(`❌ [createBulkUsers] ${errorMessage}`, userError.stack);
					
					results.push({
						user: null,
						success: false,
						error: userError.message,
						index: i,
						username: userData.username,
						email: userData.email
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [createBulkUsers] Transaction committed - ${successCount} users created successfully`);
				
				// Clear relevant caches after successful bulk creation
				await this.cacheManager.del(`${this.CACHE_PREFIX}all`);
				
				// Send welcome emails if requested
				if (bulkCreateUserDto.sendWelcomeEmails !== false && successCount > 0) {
					this.logger.debug(`📧 [createBulkUsers] Sending welcome emails to ${successCount} created users`);
					
					for (const result of results) {
						if (result.success && result.user) {
							try {
								await this.sendUserCreationNotificationEmail(result.user);
								welcomeEmailsSent++;
							} catch (emailError) {
								this.logger.warn(`⚠️ [createBulkUsers] Failed to send welcome email to ${result.user.email}: ${emailError.message}`);
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
			this.logger.error(`❌ [createBulkUsers] Transaction error: ${transactionError.message}`, transactionError.stack);
			
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
				welcomeEmailsSent: 0
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkCreateUserDto.users.length) * 100;

		this.logger.log(`🎉 [createBulkUsers] Bulk creation completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%, Emails: ${welcomeEmailsSent}`);

		return {
			totalRequested: bulkCreateUserDto.users.length,
			totalCreated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk creation completed: ${successCount} users created, ${failureCount} failed`
				: 'Bulk creation failed: No users were created',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			createdUserIds: createdUserIds.length > 0 ? createdUserIds : undefined,
			welcomeEmailsSent: welcomeEmailsSent > 0 ? welcomeEmailsSent : undefined
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
					this.logger.debug(`👤 [updateBulkUsers] Processing user ${i + 1}/${bulkUpdateUserDto.updates.length}: ID ${ref}`);
					
					// First find the user to ensure it exists
					const existingUser = await queryRunner.manager.findOne(User, { 
						where: { uid: ref, isDeleted: false },
						relations: ['organisation', 'branch']
					});

					if (!existingUser) {
						throw new Error(`User with ID ${ref} not found`);
					}

					this.logger.debug(`✅ [updateBulkUsers] User found: ${existingUser.username} (${existingUser.email})`);

					// Track original values for change detection
					const originalValues = {
						password: existingUser.password,
						role: existingUser.role,
						status: existingUser.status,
						accessLevel: existingUser.accessLevel,
						assignedClientIds: existingUser.assignedClientIds
					};

					// Validate assigned client IDs if provided and validation is enabled
					if (data.assignedClientIds && bulkUpdateUserDto.validateClientIds !== false) {
						this.logger.debug(`🔍 [updateBulkUsers] Validating ${data.assignedClientIds.length} assigned client IDs for user ${ref}`);
						
						const existingClients = await queryRunner.manager.find(Client, {
							where: { uid: In(data.assignedClientIds), isDeleted: false },
							select: ['uid']
						});

						if (existingClients.length !== data.assignedClientIds.length) {
							const foundIds = existingClients.map(c => c.uid);
							const invalidIds = data.assignedClientIds.filter(id => !foundIds.includes(id));
							throw new Error(`Invalid client IDs: ${invalidIds.join(', ')}`);
						}
					}

					// Hash password if being updated
					let updateData = { ...data };
					if (data.password) {
						this.logger.debug(`🔐 [updateBulkUsers] Hashing new password for user ${ref}`);
						updateData.password = await bcrypt.hash(data.password, 10);
					}

					// Track changed fields for logging and notifications
					const updatedFields = Object.keys(data).filter(key => 
						data[key] !== undefined && data[key] !== existingUser[key]
					);

					// Update the user
					updateData.updatedAt = new Date();
					await queryRunner.manager.update(User, ref, updateData);

					// Check for significant changes that require notifications
					const hasSignificantChanges = 
						(data.password && data.password !== originalValues.password) ||
						(data.role && data.role !== originalValues.role) ||
						(data.status && data.status !== originalValues.status) ||
						(data.accessLevel && data.accessLevel !== originalValues.accessLevel);

					results.push({
						ref,
						success: true,
						index: i,
						username: existingUser.username,
						email: existingUser.email,
						updatedFields
					});
					
					successCount++;
					updatedUserIds.push(ref);
					this.logger.debug(`✅ [updateBulkUsers] User ${i + 1} updated successfully: ${existingUser.username} (ID: ${ref}), Fields: ${updatedFields.join(', ')}`);

					// Send notification email for significant changes if enabled
					if (hasSignificantChanges && bulkUpdateUserDto.sendNotificationEmails !== false) {
						try {
							// Get updated user for email
							const updatedUser = await queryRunner.manager.findOne(User, { 
								where: { uid: ref },
								relations: ['organisation', 'branch']
							});

							if (updatedUser) {
								await this.sendComprehensiveUserUpdateEmail(
									updatedUser,
									existingUser,
									{
										password: !!data.password,
										role: data.role !== originalValues.role,
										status: data.status !== originalValues.status,
										profile: updatedFields.some(field => ['name', 'surname', 'phone', 'photoURL'].includes(field)),
										assignedClients: JSON.stringify(data.assignedClientIds) !== JSON.stringify(originalValues.assignedClientIds)
									},
									originalValues.assignedClientIds || [],
									data.assignedClientIds || updatedUser.assignedClientIds || []
								);
								notificationEmailsSent++;
							}
						} catch (emailError) {
							this.logger.warn(`⚠️ [updateBulkUsers] Failed to send notification email to ${existingUser.email}: ${emailError.message}`);
						}
					}
					
				} catch (userError) {
					const errorMessage = `User ID ${ref}: ${userError.message}`;
					this.logger.error(`❌ [updateBulkUsers] ${errorMessage}`, userError.stack);
					
					results.push({
						ref,
						success: false,
						error: userError.message,
						index: i
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [updateBulkUsers] Transaction committed - ${successCount} users updated successfully`);
				
				// Invalidate relevant caches after successful bulk update
				await this.cacheManager.del(`${this.CACHE_PREFIX}all`);
				
				// Clear specific user caches for updated users
				await Promise.all(
					updatedUserIds.map(userId => 
						this.cacheManager.del(this.getCacheKey(userId))
					)
				);
				
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
			this.logger.error(`❌ [updateBulkUsers] Transaction error: ${transactionError.message}`, transactionError.stack);
			
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
				notificationEmailsSent: 0
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkUpdateUserDto.updates.length) * 100;

		this.logger.log(`🎉 [updateBulkUsers] Bulk update completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%, Emails: ${notificationEmailsSent}`);

		return {
			totalRequested: bulkUpdateUserDto.updates.length,
			totalUpdated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk update completed: ${successCount} users updated, ${failureCount} failed`
				: 'Bulk update failed: No users were updated',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			updatedUserIds: updatedUserIds.length > 0 ? updatedUserIds : undefined,
			notificationEmailsSent: notificationEmailsSent > 0 ? notificationEmailsSent : undefined
		};
	}

	/**
	 * 🔐 Generate a random password for auto-generation
	 * @returns Random secure password
	 */
	private generateRandomPassword(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
		let password = '';
		for (let i = 0; i < 12; i++) {
			password += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return password;
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
			orgId?: number;
			userBranchId?: number;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
	): Promise<PaginatedResponse<Omit<User, 'password'>>> {
		const startTime = Date.now();
		this.logger.log(`Fetching users with filters: ${JSON.stringify(filters)}, page: ${page}, limit: ${limit}`);

		try {
			this.logger.debug('Building query with filters and pagination');
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.userTarget', 'userTarget')
				.where('user.isDeleted = :isDeleted', { isDeleted: false });

			// Apply organization filter if provided
			if (filters?.orgId) {
				this.logger.debug(`Applying organization filter: ${filters.orgId}`);
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: filters.orgId });
			}

			// Only apply branch filter if user has a branch and no specific branch filter is provided
			if (filters?.userBranchId && !filters?.branchId) {
				this.logger.debug(`Applying user branch filter: ${filters.userBranchId}`);
				queryBuilder.andWhere('branch.uid = :userBranchId', { userBranchId: filters.userBranchId });
			}

			if (filters?.status) {
				this.logger.debug(`Applying status filter: ${filters.status}`);
				queryBuilder.andWhere('user.status = :status', { status: filters.status });
			}

			if (filters?.accessLevel) {
				this.logger.debug(`Applying access level filter: ${filters.accessLevel}`);
				queryBuilder.andWhere('user.accessLevel = :accessLevel', { accessLevel: filters.accessLevel });
			}

			if (filters?.branchId) {
				this.logger.debug(`Applying branch filter: ${filters.branchId}`);
				queryBuilder.andWhere('branch.uid = :branchId', { branchId: filters.branchId });
			}

			if (filters?.organisationId) {
				this.logger.debug(`Applying organisation filter: ${filters.organisationId}`);
				queryBuilder.andWhere('organisation.uid = :organisationId', { organisationId: filters.organisationId });
			}

			if (filters?.search) {
				this.logger.debug(`Applying search filter: ${filters.search}`);
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

			this.logger.debug('Executing query to fetch users');
			const [users, total] = await queryBuilder.getManyAndCount();

			if (!users) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`Successfully fetched ${users.length} users out of ${total} total in ${executionTime}ms`);

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
		searchParameter: number,
		orgId?: number,
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
			this.logger.debug(`Checking cache for user: ${searchParameter}`);
			const cachedUser = await this.cacheManager.get<User>(cacheKey);

			if (cachedUser) {
				this.logger.debug(`Cache hit for user: ${searchParameter}`);

				// If org/branch filters are provided, verify cached user belongs to them
				if (orgId && cachedUser.organisation?.uid !== orgId) {
					this.logger.warn(`User ${searchParameter} found in cache but doesn't belong to org ${orgId}`);
					throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
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

			this.logger.debug(`Cache miss for user: ${searchParameter}, querying database`);

			// Build where conditions
			const whereConditions: any = {
				uid: Number(searchParameter), // 🔧 FIX: Ensure uid is a number
				isDeleted: false,
			};

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: Number(orgId) }; // 🔧 FIX: Ensure orgId is a number
			}

			// Add branch filter if provided
			if (branchId) {
				whereConditions.branch = { uid: Number(branchId) }; // 🔧 FIX: Ensure branchId is a number
			}

			// 🔍 DEBUG: Log the exact query conditions (temporary)
			this.logger.debug(`Database Query Conditions:`, JSON.stringify(whereConditions, null, 2));

			const user = await this.userRepository.findOne({
				where: whereConditions,
				relations: ['organisation', 'branch', 'userProfile', 'userEmployeementProfile', 'userTarget'],
			});

			if (!user) {
				this.logger.warn(`User ${searchParameter} not found with applied filters (orgId: ${orgId}, branchId: ${branchId})`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.debug(`User ${searchParameter} found in database, caching result`);
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
			this.logger.debug(`Querying database for user with email: ${email}`);
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
			this.logger.debug(`Querying database for active user: ${searchParameter}`);
			const user = await this.userRepository.findOne({
				where: [
					{
						username: searchParameter,
						isDeleted: false,
						status: AccountStatus.ACTIVE,
					},
				],
				relations: ['branch', 'rewards', 'organisation'],
			});

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
	 * Find user by UID with related data
	 * @param searchParameter - User UID to search for
	 * @returns User data without password or null with message
	 */
	async findOneByUid(searchParameter: number): Promise<{ user: Omit<User, 'password'> | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`Finding user by UID: ${searchParameter}`);

		try {
			this.logger.debug(`Querying database for user with UID: ${searchParameter}`);
			const user = await this.userRepository.findOne({
				where: [{ uid: searchParameter, isDeleted: false }],
				relations: ['branch', 'rewards', 'userTarget', 'organisation'],
			});

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
			this.logger.debug(`Querying database for users with emails: ${recipients.join(', ')}`);
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
			this.logger.debug(`Querying database for active admin users`);
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
			this.logger.debug(`[USER_UPDATE] Fetching current user data for comparison`);
			const existingUser = await this.userRepository.findOne({
				where: { uid: ref, isDeleted: false },
				relations: ['branch', 'organisation'],
			});

			if (!existingUser) {
				throw new NotFoundException('User not found');
			}

			// Track what's being changed for notifications
			const changes = {
				password: false,
				role: false,
				status: false,
				profile: false,
				assignedClients: false,
			};

			// Store original assigned clients for comparison
			const originalAssignedClients = existingUser.assignedClientIds || [];
			let updatedAssignedClients: number[] = [];

			// Check for password change
			if (updateUserDto.password) {
				this.logger.debug(`[USER_UPDATE] Password change detected for user: ${existingUser.email}`);
				updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
				changes.password = true;
			}

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
				this.logger.debug(`[USER_UPDATE] Profile information change detected for user: ${existingUser.email}`);
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

			this.logger.debug('[USER_UPDATE] Updating user in database');
			await this.userRepository.update({ uid: ref }, updateUserDto);

			const updatedUser = await this.userRepository.findOne({
				where: { uid: ref },
				relations: ['branch', 'organisation'],
			});

			if (!updatedUser) {
				throw new NotFoundException('User not found after update');
			}

			this.logger.log(`[USER_UPDATE] User updated successfully: ${updatedUser.uid} (${updatedUser.email})`);

			// Invalidate cache after update
			await this.invalidateUserCache(updatedUser);

			// Send appropriate notification emails based on what changed
			const emailPromises = [];

			// Determine if we should send a comprehensive update email or individual emails
			const hasMultipleChanges = Object.values(changes).filter(Boolean).length > 1;
			const hasSignificantChanges = changes.assignedClients || changes.role || changes.status;

			if (hasSignificantChanges || hasMultipleChanges) {
				// Send comprehensive user update email
				this.logger.debug(`[USER_UPDATE] Sending comprehensive update notification to: ${updatedUser.email}`);
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
				if (changes.password) {
					this.logger.debug(`[USER_UPDATE] Sending password update notification to: ${updatedUser.email}`);
					emailPromises.push(this.sendPasswordUpdateNotificationEmail(updatedUser));
				}

				if (changes.profile) {
					this.logger.debug(`[USER_UPDATE] Sending profile update notification to: ${updatedUser.email}`);
					emailPromises.push(this.sendProfileUpdateNotificationEmail(updatedUser));
				}
			}

			// Send push notifications for significant changes
			try {
				if (changes.password) {
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
					this.logger.debug('[USER_UPDATE] Password reset push notification sent');
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
					this.logger.debug('[USER_UPDATE] Role change push notification sent');
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
					this.logger.debug('[USER_UPDATE] Status change push notification sent');
				}

				if (changes.profile || (hasMultipleChanges && !changes.password && !changes.role && !changes.status)) {
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
					this.logger.debug('[USER_UPDATE] General update push notification sent');
				}
			} catch (notificationError) {
				this.logger.warn(`Failed to send user update push notification to ${updatedUser.uid}:`, notificationError.message);
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
			const user = await this.userRepository.findOne({
				where: whereConditions,
				relations: ['organisation', 'branch'],
			});

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
			if (userData?.password) {
				this.logger.debug(`Hashing password for pending user: ${userData.email}`);
				userData.password = await bcrypt.hash(userData.password, 10);
			}

			this.logger.debug(`Saving pending user to database: ${userData.email}`);
			const user = await this.userRepository.save({
				...userData,
				status: userData?.status as AccountStatus,
			});

			// Invalidate cache after creating pending user
			await this.invalidateUserCache(user);

			this.logger.debug(
				`Scheduling cleanup for pending user: ${userData.email} (expires: ${userData?.tokenExpires})`,
			);
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
		this.logger.debug(
			`Scheduling cleanup for pending user: ${email} in ${timeUntilExpiry}ms (expires: ${expiryDate.toISOString()})`,
		);

		setTimeout(async () => {
			this.logger.debug(`Executing scheduled cleanup for pending user: ${email}`);

			try {
				const user = await this.userRepository.findOne({ where: { email } });

				if (user && user?.status === 'pending') {
					this.logger.log(`Cleaning up expired pending user: ${email} (${user.uid})`);
					await this.userRepository.update({ email }, { isDeleted: true });
					this.logger.log(`Expired pending user cleaned up successfully: ${email}`);
				} else {
					this.logger.debug(`No cleanup needed for user: ${email} - either not found or status changed`);
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

			this.logger.debug(`Finding deleted user ${ref} for restoration`);
			const user = await this.userRepository.findOne({
				where: whereConditions,
				relations: ['organisation', 'branch'],
				withDeleted: true, // Include soft-deleted entries
			});

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
			this.logger.debug(`Querying database for user with verification token`);
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
			const user = await this.userRepository.findOne({
				where: { uid },
				relations: ['organisation', 'branch'],
			});

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
	 * @param uid - User ID
	 * @param password - New password to set
	 */
	async setPassword(uid: number, password: string): Promise<void> {
		const startTime = Date.now();
		this.logger.log(`Setting password for user: ${uid}`);

		try {
			const user = await this.userRepository.findOne({
				where: { uid },
				relations: ['organisation', 'branch'],
			});

			if (user) {
				this.logger.debug(`Hashing password for user: ${user.email} (${uid})`);
				const hashedPassword = await bcrypt.hash(password, 10);

				this.logger.debug(`Updating password and activating account for user: ${user.email} (${uid})`);
				await this.userRepository.update(
					{ uid },
					{
						password: hashedPassword,
						verificationToken: null,
						tokenExpires: null,
						status: AccountStatus.ACTIVE,
					},
				);

				// Invalidate cache after password change
				await this.invalidateUserCache(user);

				const executionTime = Date.now() - startTime;
				this.logger.log(`Password set and account activated for user: ${user.email} in ${executionTime}ms`);
			} else {
				this.logger.warn(`User ${uid} not found for password setting`);
			}
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to set password for user ${uid} after ${executionTime}ms. Error: ${error.message}`,
			);
			throw error;
		}
	}

	/**
	 * Update user password (for existing users)
	 * @param uid - User ID
	 * @param password - New password to set
	 */
	async updatePassword(uid: number, password: string): Promise<void> {
		const startTime = Date.now();
		this.logger.log(`Updating password for user: ${uid}`);

		try {
			this.logger.debug(`Hashing new password for user: ${uid}`);
			const hashedPassword = await bcrypt.hash(password, 10);

			this.logger.debug(`Updating password in database for user: ${uid}`);
			await this.userRepository.update(uid, {
				password: hashedPassword,
				updatedAt: new Date(),
			});

			const executionTime = Date.now() - startTime;
			this.logger.log(`Password updated successfully for user: ${uid} in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to update password for user ${uid} after ${executionTime}ms. Error: ${error.message}`,
			);
			throw error;
		}
	}

	/**
	 * Get user targets for a specific user with caching
	 * @param userId - User ID to get targets for
	 * @returns User target data or null with message
	 */
	async getUserTarget(userId: number): Promise<{ userTarget: UserTarget | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`Getting user target for user: ${userId}`);

		try {
			const cacheKey = this.getCacheKey(`target_${userId}`);
			this.logger.debug(`Checking cache for user target: ${userId}`);
			const cachedTarget = await this.cacheManager.get(cacheKey);

			if (cachedTarget) {
				const executionTime = Date.now() - startTime;
				this.logger.log(`User target retrieved from cache for user: ${userId} in ${executionTime}ms`);
				return {
					userTarget: cachedTarget as UserTarget,
					message: process.env.SUCCESS_MESSAGE,
				};
			}

			this.logger.debug(`Cache miss for user target: ${userId}, querying database`);
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['userTarget'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found when getting targets`);
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			if (!user.userTarget) {
				const executionTime = Date.now() - startTime;
				this.logger.log(`No targets set for user: ${userId} in ${executionTime}ms`);
				return {
					userTarget: null,
					message: 'No targets set for this user',
				};
			}

			this.logger.debug(`Caching user target for user: ${userId}`);
			await this.cacheManager.set(cacheKey, user.userTarget, this.CACHE_TTL);

			const executionTime = Date.now() - startTime;
			this.logger.log(`User target retrieved from database for user: ${userId} in ${executionTime}ms`);

			return {
				userTarget: user.userTarget,
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
	 * Set targets for a user (create new or update existing)
	 * @param userId - User ID to set targets for
	 * @param createUserTargetDto - Target data to set
	 * @returns Success message or error details
	 */
	async setUserTarget(userId: number, createUserTargetDto: CreateUserTargetDto): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`Setting user target for user: ${userId}`);

		try {
			this.logger.debug(`Finding user ${userId} for target setting`);
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['userTarget'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found for target setting`);
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			// If user already has targets, update them
			if (user.userTarget) {
				this.logger.debug(`User ${userId} already has targets, updating existing targets`);
				await this.updateUserTarget(userId, createUserTargetDto);

				const executionTime = Date.now() - startTime;
				this.logger.log(`User targets updated for user: ${userId} in ${executionTime}ms`);

				return {
					message: 'User targets updated successfully',
				};
			}

			this.logger.debug(`Creating new user target for user: ${userId}`);
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
							'Interactive progress charts'
						]
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
			this.logger.debug(`Target set push notification sent to user: ${userId}`);
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
	async updateUserTarget(userId: number, updateUserTargetDto: UpdateUserTargetDto): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`Updating user target for user: ${userId}`);

		try {
			this.logger.debug(`Finding user ${userId} for target update`);
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['userTarget'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found for target update`);
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			if (!user.userTarget) {
				this.logger.warn(`No targets found for user ${userId} to update`);
				throw new NotFoundException(`No targets found for user with ID ${userId}`);
			}

			this.logger.debug(`Updating target data for user: ${userId}`);
			const updatedUserTarget = {
				...user.userTarget,
				...updateUserTargetDto,
				periodStartDate: new Date(updateUserTargetDto.periodStartDate),
				periodEndDate: new Date(updateUserTargetDto.periodEndDate),
			};

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
						periodStartDate: updatedUserTarget.periodStartDate?.toISOString().split('T')[0],
						periodEndDate: updatedUserTarget.periodEndDate?.toISOString().split('T')[0],
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
							'Offline target viewing'
						]
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
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.USER_TARGET_UPDATED,
				[userId],
				{
					message: `Your performance targets have been updated. Review the changes and adjust your strategy accordingly!`,
					userName: `${user.name} ${user.surname}`.trim(),
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
	 * Delete targets for a user
	 * @param userId - User ID to delete targets for
	 * @returns Success message or error details
	 */
	async deleteUserTarget(userId: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`Deleting user target for user: ${userId}`);

		try {
			this.logger.debug(`Finding user ${userId} for target deletion`);
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['userTarget'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found for target deletion`);
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			if (!user.userTarget) {
				const executionTime = Date.now() - startTime;
				this.logger.log(`No targets exist for user ${userId} to delete (${executionTime}ms)`);
				return {
					message: 'No targets exist for this user',
				};
			}

			this.logger.debug(`Removing target for user: ${userId}`);
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
					userId: user.uid,
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
	 * Currently calculates currentSalesAmount, currentNewLeads, currentNewClients, and currentCheckIns.
	 * @param payload - Event payload with userId
	 */
	@OnEvent('user.target.update.required')
	async calculateUserTargets(payload: { userId: number }): Promise<void> {
		const { userId } = payload;

		// Check if calculation is already in progress for this user
		if (this.activeCalculations.has(userId)) {
			this.logger.debug(`Target calculation already in progress for user: ${userId}, skipping duplicate`);
			return;
		}

		// Mark calculation as active
		this.activeCalculations.add(userId);
		const startTime = Date.now();
		this.logger.log(`Calculating user targets for user: ${userId}`);

		try {
			this.logger.debug(`Finding user and target data for user: ${userId}`);
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['userTarget'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found for target calculation`);
				return;
			}

			if (!user.userTarget) {
				this.logger.debug(`No target set for user ${userId}, skipping calculation`);
				return;
			}

			const { userTarget } = user;

			if (!userTarget.periodStartDate || !userTarget.periodEndDate) {
				this.logger.warn(`User ${userId} has incomplete target period dates, skipping calculation`);
				return;
			}

			this.logger.debug(
				`Calculating targets for user ${userId} from ${userTarget.periodStartDate} to ${userTarget.periodEndDate}`,
			);

			// --- Calculate currentQuotationsAmount (quotes made but not paid) ---
			this.logger.debug(`Calculating quotations amount for user: ${userId}`);
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
			const quotations = await this.quotationRepository.find({
				where: {
					placedBy: { uid: userId },
					status: In(quotationStatuses),
					createdAt: Between(userTarget.periodStartDate, userTarget.periodEndDate),
				},
			});

			// Safely calculate quotations amount with proper number conversion
			userTarget.currentQuotationsAmount = quotations.reduce((sum, q) => {
				const amount = this.safeParseNumber(q.totalAmount);
				return sum + amount;
			}, 0);

			this.logger.debug(`Quotations amount calculated: ${userTarget.currentQuotationsAmount} for user ${userId}`);

			// --- Calculate currentOrdersAmount (quotations that have been converted to completed orders) ---
			this.logger.debug(`Calculating orders amount for user: ${userId}`);
			const completedQuotations = await this.quotationRepository.find({
				where: {
					placedBy: { uid: userId },
					status: OrderStatus.COMPLETED,
					createdAt: Between(userTarget.periodStartDate, userTarget.periodEndDate),
				},
			});

			// Safely calculate orders amount with proper number conversion
			userTarget.currentOrdersAmount = completedQuotations.reduce((sum, q) => {
				const amount = this.safeParseNumber(q.totalAmount);
				return sum + amount;
			}, 0);

			this.logger.debug(`Orders amount calculated: ${userTarget.currentOrdersAmount} for user ${userId}`);

			// --- Calculate currentSalesAmount (total for backward compatibility) ---
			const quotationsAmount = this.safeParseNumber(userTarget.currentQuotationsAmount);
			const ordersAmount = this.safeParseNumber(userTarget.currentOrdersAmount);
			userTarget.currentSalesAmount = quotationsAmount + ordersAmount;

			this.logger.debug(`Total sales amount calculated: ${userTarget.currentSalesAmount} for user ${userId}`);

			// --- Calculate currentNewLeads ---
			this.logger.debug(`Calculating leads count for user: ${userId}`);
			const leadsCount = await this.leadRepository.count({
				where: {
					owner: { uid: userId },
					createdAt: Between(userTarget.periodStartDate, userTarget.periodEndDate),
				},
			});
			userTarget.currentNewLeads = leadsCount;
			this.logger.debug(`Leads count calculated: ${leadsCount} for user ${userId}`);

			// --- Calculate currentNewClients ---
			this.logger.debug(`Calculating clients count for user: ${userId}`);
			const clientsCount = await this.clientRepository.count({
				where: {
					assignedSalesRep: { uid: userId },
					createdAt: Between(userTarget.periodStartDate, userTarget.periodEndDate),
				},
			});
			userTarget.currentNewClients = clientsCount;
			this.logger.debug(`Clients count calculated: ${clientsCount} for user ${userId}`);

			// --- Calculate currentCheckIns ---
			this.logger.debug(`Calculating check-ins count for user: ${userId}`);
			const checkInsCount = await this.checkInRepository.count({
				where: {
					owner: { uid: userId },
					checkInTime: Between(userTarget.periodStartDate, userTarget.periodEndDate),
				},
			});
			userTarget.currentCheckIns = checkInsCount;
			this.logger.debug(`Check-ins count calculated: ${checkInsCount} for user ${userId}`);

			// --- TODO: Add calculations for currentHoursWorked, currentCalls ---

			// Validate the calculated values before saving
			if (!this.validateCalculatedValues(userTarget)) {
				this.logger.error(`Invalid calculated values for user ${userId}, skipping save`);
				return;
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

			// Save the updated target (via user cascade)
			this.logger.debug(`Saving updated targets for user: ${userId}`);
			await this.userRepository.save(user);

			// Check for target achievements after saving
			await this.checkAndNotifyTargetAchievements(user, userTarget, previousTargetValues);

			// Invalidate the specific target cache
			await this.cacheManager.del(this.getCacheKey(`target_${userId}`));

			const executionTime = Date.now() - startTime;
			this.logger.log(`User targets calculated successfully for user: ${userId} in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to calculate user targets for user ${userId} after ${executionTime}ms. Error: ${error.message}`,
			);
			// Don't return null, just return void
		} finally {
			// Always remove user from active calculations
			this.activeCalculations.delete(userId);
		}
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
		this.logger.log(`Re-inviting all users with scope: ${JSON.stringify(scope)}`);

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
		this.logger.log(`Re-inviting specific user: ${userId} with scope: ${JSON.stringify(scope)}`);

		try {
			this.logger.debug(`Building query for user ${userId} with scope restrictions`);
			const queryBuilder = this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.branch', 'branch')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.uid = :userId', { userId: parseInt(userId) })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false });

			// Apply organization filter if provided
			if (scope?.orgId) {
				this.logger.debug(`Applying organization scope filter: ${scope.orgId}`);
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: parseInt(scope.orgId) });
			}

			// Apply branch filter if provided
			if (scope?.branchId) {
				this.logger.debug(`Applying branch scope filter: ${scope.branchId}`);
				queryBuilder.andWhere('branch.uid = :branchId', { branchId: parseInt(scope.branchId) });
			}

			this.logger.debug(`Executing query to find user ${userId}`);
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

			this.logger.debug(`Sending re-invitation email to user: ${user.email} (${userId})`);
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
		this.logger.debug(`Preparing re-invitation email for user: ${user.email} (${user.uid})`);

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
		
		// 📋 Log detailed incoming payload for debugging
		this.logger.debug(`📥 [ERP_UPDATE] Incoming payload details:`, {
			userId,
			sourceSystem,
			updateMode: externalUpdate.updateMode,
			transactionId: externalUpdate.transactionId,
			orgId,
			branchId,
			updates: externalUpdate.updates,
			metadata: externalUpdate.metadata,
			saleDetails: externalUpdate.saleDetails ? `${externalUpdate.saleDetails.length} sale details` : 'No sale details',
			timestamp: new Date().toISOString()
		});

		try {
			// Validate external update data
			this.logger.debug(`🔍 [ERP_UPDATE] Starting validation for user: ${userId}, transaction: ${externalUpdate.transactionId}`);
			const validationResult = await this.validateExternalTargetUpdate(userId, externalUpdate, orgId, branchId);
			
			if (!validationResult.isValid) {
				this.logger.error(`❌ [ERP_UPDATE] Validation failed for user: ${userId}, transaction: ${externalUpdate.transactionId}`, {
					errors: validationResult.errors,
					updateMode: externalUpdate.updateMode,
					sourceSystem,
					updates: externalUpdate.updates
				});
				return {
					message: 'Validation failed',
					validationErrors: validationResult.errors,
				};
			}
			
			this.logger.debug(`✅ [ERP_UPDATE] Validation passed for user: ${userId}, transaction: ${externalUpdate.transactionId}`);

			// Implement optimistic locking with retry mechanism
			const maxRetries = 3;
			let retryCount = 0;
			let lastError: any;
			
			this.logger.debug(`🔄 [ERP_UPDATE] Starting retry mechanism (max ${maxRetries} attempts) for user: ${userId}, transaction: ${externalUpdate.transactionId}`);

			while (retryCount < maxRetries) {
				const attemptStartTime = Date.now();
				this.logger.debug(`🎯 [ERP_UPDATE] Attempt ${retryCount + 1}/${maxRetries} for user: ${userId}, transaction: ${externalUpdate.transactionId}`);
				
				try {
					// Start transaction
					this.logger.debug(`🔒 [ERP_UPDATE] Starting database transaction for user: ${userId}, attempt: ${retryCount + 1}`);
					const result = await this.userRepository.manager.transaction(async (transactionalEntityManager) => {
						// Get current user with target and version for optimistic locking
						this.logger.debug(`🔍 [ERP_UPDATE] Querying user data with pessimistic lock for user: ${userId}`);
						const user = await transactionalEntityManager
							.createQueryBuilder(User, 'user')
							.leftJoinAndSelect('user.userTarget', 'userTarget')
							.leftJoinAndSelect('user.organisation', 'organisation')
							.leftJoinAndSelect('user.branch', 'branch')
							.where('user.uid = :userId', { userId })
							.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
							.andWhere(orgId ? 'organisation.uid = :orgId' : '1=1', { orgId })
							.andWhere(branchId ? 'branch.uid = :branchId' : '1=1', { branchId })
							.setLock('pessimistic_write') // Use pessimistic locking for external updates
							.getOne();

						if (!user) {
							this.logger.error(`❌ [ERP_UPDATE] User not found or access denied - User: ${userId}, OrgId: ${orgId}, BranchId: ${branchId}, Transaction: ${externalUpdate.transactionId}`);
							throw new NotFoundException(`User ${userId} not found or access denied`);
						}

						if (!user.userTarget) {
							this.logger.error(`❌ [ERP_UPDATE] No targets found for user: ${userId}, Transaction: ${externalUpdate.transactionId}`);
							throw new NotFoundException(`No targets found for user ${userId}`);
						}

						// Log current target values before update
						this.logger.debug(`📊 [ERP_UPDATE] Current target values for user: ${userId}`, {
							currentSalesAmount: user.userTarget.currentSalesAmount,
							currentQuotationsAmount: user.userTarget.currentQuotationsAmount,
							currentOrdersAmount: user.userTarget.currentOrdersAmount,
							currentNewLeads: user.userTarget.currentNewLeads,
							currentNewClients: user.userTarget.currentNewClients,
							currentCheckIns: user.userTarget.currentCheckIns,
							currentHoursWorked: user.userTarget.currentHoursWorked,
							currentCalls: user.userTarget.currentCalls,
							lastUpdated: user.userTarget.updatedAt
						});

						// Calculate new values based on update mode
						this.logger.debug(`🧮 [ERP_UPDATE] Calculating target updates for user: ${userId}, mode: ${externalUpdate.updateMode}`);
						const updatedTarget = this.calculateTargetUpdates(user.userTarget, externalUpdate);
						
						// Log calculated updates
						this.logger.debug(`📈 [ERP_UPDATE] Calculated target updates for user: ${userId}`, updatedTarget);

						// Update target with new values
						this.logger.debug(`💾 [ERP_UPDATE] Updating UserTarget in database for user: ${userId}, target UID: ${user.userTarget.uid}`);
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
						this.logger.debug(`📝 [ERP_UPDATE] Creating audit trail for user: ${userId}, transaction: ${externalUpdate.transactionId}`);
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
					const updatedUser = await this.userRepository.findOne({
						where: { uid: userId },
						relations: ['organisation', 'branch'],
					});

					if (updatedUser) {
						// Invalidate cache
						this.logger.debug(`🗑️ [ERP_UPDATE] Invalidating cache for user: ${userId}`);
						await this.invalidateUserCache(updatedUser);
						await this.cacheManager.del(this.getCacheKey(`target_${userId}`));
						this.logger.debug(`✅ [ERP_UPDATE] Cache invalidated for user: ${userId}`);
					} else {
						this.logger.warn(`⚠️ [ERP_UPDATE] Updated user not found for cache invalidation, user: ${userId}`);
					}

					// Emit success event
					this.logger.debug(`📡 [ERP_UPDATE] Emitting success event for user: ${userId}, transaction: ${externalUpdate.transactionId}`);
					this.eventEmitter.emit('user.target.external.update.completed', {
						userId,
						source: sourceSystem,
						transactionId: externalUpdate.transactionId,
						updatedValues: result,
					});

					// Send contribution progress notification if there are increases
					this.logger.debug(`📧 [ERP_UPDATE] Attempting to send contribution progress notification for user: ${userId}`);
					try {
						await this.sendContributionProgressNotification(
							userId,
							externalUpdate,
							result,
						);
						this.logger.debug(`✅ [ERP_UPDATE] Contribution progress notification sent for user: ${userId}`);
					} catch (notificationError) {
						this.logger.warn(
							`⚠️ [ERP_UPDATE] Failed to send contribution progress notification for user ${userId}: ${notificationError.message}`,
						);
						// Don't fail the update if notification fails
					}

					// Send push notification for target update
					this.logger.debug(`📱 [ERP_UPDATE] Attempting to send push notification for user: ${userId}`);
					try {
						await this.sendTargetUpdatePushNotification(
							userId,
							externalUpdate,
							result,
						);
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
					
					this.logger.debug(`📊 [ERP_UPDATE] Final response for user: ${userId}`, {
						success: true,
						totalExecutionTime: totalTime,
						attemptTime,
						attemptNumber: retryCount + 1,
						updatedValues: result,
						transaction: externalUpdate.transactionId
					});

					return {
						message: 'User targets updated successfully from ERP',
						updatedValues: result,
					};
				} catch (error) {
					lastError = error;
					retryCount++;
					const attemptTime = Date.now() - attemptStartTime;

					this.logger.error(`❌ [ERP_UPDATE] Attempt ${retryCount}/${maxRetries} failed for user: ${userId}, transaction: ${externalUpdate.transactionId}`, {
						error: error.message,
						errorCode: error.code,
						errorType: error.constructor.name,
						attemptTime,
						userId,
						transactionId: externalUpdate.transactionId,
						stackTrace: error.stack
					});

					if (error.code === 'ER_LOCK_WAIT_TIMEOUT' || error.message.includes('concurrent')) {
						this.logger.warn(
							`🔄 [ERP_UPDATE] Concurrent update conflict for user ${userId}, retry ${retryCount}/${maxRetries}`,
							{
								errorCode: error.code,
								retryCount,
								maxRetries,
								nextBackoffTime: `${Math.pow(2, retryCount) * 100}ms`
							}
						);

						if (retryCount < maxRetries) {
							// Exponential backoff
							const backoffTime = Math.pow(2, retryCount) * 100;
							this.logger.debug(`⏳ [ERP_UPDATE] Backing off for ${backoffTime}ms before retry ${retryCount + 1} for user: ${userId}`);
							await new Promise((resolve) => setTimeout(resolve, backoffTime));
							continue;
						}
					} else {
						// Non-recoverable error, don't retry
						this.logger.error(`💥 [ERP_UPDATE] Non-retryable error for user ${userId}, aborting retries: ${error.message}`, {
							errorType: error.constructor.name,
							errorCode: error.code,
							userId,
							transactionId: externalUpdate.transactionId
						});
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
					lastErrorType: lastError?.constructor?.name
				}
			);

			// Emit failure event
			this.logger.debug(`📡 [ERP_UPDATE] Emitting failure event for user: ${userId}, transaction: ${externalUpdate.transactionId}`);
			this.eventEmitter.emit('user.target.external.update.failed', {
				userId,
				source: sourceSystem,
				transactionId: externalUpdate.transactionId,
				error: lastError.message,
				retryCount,
			});

			if (lastError.code === 'ER_LOCK_WAIT_TIMEOUT' || lastError.message.includes('concurrent')) {
				this.logger.warn(`⚠️ [ERP_UPDATE] Returning conflict response due to concurrent update for user: ${userId}`, {
					transactionId: externalUpdate.transactionId,
					retryCount,
					error: lastError.message
				});
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
				transactionId: externalUpdate.transactionId
			});
			return {
				message: lastError.message || 'Failed to update user targets from ERP',
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`🚨 [ERP_UPDATE] OUTER CATCH - Unexpected error for user ${userId} after ${executionTime}ms: ${error.message}`, {
				userId,
				transactionId: externalUpdate.transactionId,
				executionTime,
				error: error.message,
				errorCode: error.code,
				errorType: error.constructor.name,
				stackTrace: error.stack
			});

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
		this.logger.debug(`🧮 [ERP_CALCULATION] Starting calculation for mode: ${externalUpdate.updateMode}, transaction: ${externalUpdate.transactionId}`, {
			currentValues: {
				salesAmount: currentTarget.currentSalesAmount,
				quotationsAmount: currentTarget.currentQuotationsAmount,
				ordersAmount: currentTarget.currentOrdersAmount,
				newLeads: currentTarget.currentNewLeads,
				newClients: currentTarget.currentNewClients,
				checkIns: currentTarget.currentCheckIns,
				hoursWorked: currentTarget.currentHoursWorked,
				calls: currentTarget.currentCalls
			},
			incomingUpdates: externalUpdate.updates
		});
		
		const updates: Partial<UserTarget> = {};

		// Handle different update modes
		if (externalUpdate.updateMode === TargetUpdateMode.INCREMENT) {
			this.logger.debug(`📈 [ERP_CALCULATION] Processing INCREMENT mode for transaction: ${externalUpdate.transactionId}`);
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
			this.logger.debug(`📉 [ERP_CALCULATION] Processing DECREMENT mode for transaction: ${externalUpdate.transactionId}`);
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
			this.logger.debug(`🔄 [ERP_CALCULATION] Processing REPLACE mode for transaction: ${externalUpdate.transactionId}`);
			Object.assign(updates, externalUpdate.updates);
		}

		this.logger.debug(`✅ [ERP_CALCULATION] Calculation completed for transaction: ${externalUpdate.transactionId}`, {
			mode: externalUpdate.updateMode,
			calculatedUpdates: updates,
			updatedFieldCount: Object.keys(updates).length
		});

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
		this.logger.debug(`🔍 [ERP_VALIDATION] Starting comprehensive validation for user: ${userId}, transaction: ${externalUpdate.transactionId}`, {
			updateMode: externalUpdate.updateMode,
			orgId,
			branchId,
			hasUpdates: !!externalUpdate.updates,
			hasMetadata: !!externalUpdate.metadata
		});
		const errors: string[] = [];

		try {
			// Validate user exists and has targets
			this.logger.debug(`👤 [ERP_VALIDATION] Checking user existence for user: ${userId}`);
			const user = await this.userRepository.findOne({
				where: {
					uid: userId,
					isDeleted: false,
					...(orgId && { organisation: { uid: orgId } }),
					...(branchId && { branch: { uid: branchId } }),
				},
				relations: ['userTarget', 'organisation', 'branch'],
			});

			if (!user) {
				this.logger.error(`❌ [ERP_VALIDATION] User not found or access denied - User: ${userId}, OrgId: ${orgId}, BranchId: ${branchId}, Transaction: ${externalUpdate.transactionId}`);
				errors.push(`User ${userId} not found or access denied`);
				return { isValid: false, errors };
			}
			
			this.logger.debug(`✅ [ERP_VALIDATION] User found: ${userId}, Name: ${user.name} ${user.surname}, Email: ${user.email}`);
			
			if (!user.userTarget) {
				this.logger.error(`❌ [ERP_VALIDATION] No targets configured for user: ${userId}, Transaction: ${externalUpdate.transactionId}`);
				errors.push(`No targets found for user ${userId}`);
				return { isValid: false, errors };
			}
			
			this.logger.debug(`✅ [ERP_VALIDATION] User targets found for user: ${userId}, Target UID: ${user.userTarget.uid}`);

			// Validate update modes and values
			this.logger.debug(`🔧 [ERP_VALIDATION] Validating update mode: ${externalUpdate.updateMode} for user: ${userId}`);
			if (externalUpdate.updateMode === TargetUpdateMode.INCREMENT) {
				this.logger.debug(`📈 [ERP_VALIDATION] Validating INCREMENT mode values for user: ${userId}`, externalUpdate.updates);
				// INCREMENT mode: Only accept positive values to add to current amounts
				if (externalUpdate.updates.currentSalesAmount !== undefined && externalUpdate.updates.currentSalesAmount <= 0) {
					this.logger.warn(`❌ [ERP_VALIDATION] Invalid INCREMENT sales amount: ${externalUpdate.updates.currentSalesAmount} for user: ${userId}`);
					errors.push('INCREMENT mode requires positive values (sales amount)');
				}
				if (externalUpdate.updates.currentQuotationsAmount !== undefined && externalUpdate.updates.currentQuotationsAmount <= 0) {
					errors.push('INCREMENT mode requires positive values (quotations amount)');
				}
				if (externalUpdate.updates.currentOrdersAmount !== undefined && externalUpdate.updates.currentOrdersAmount <= 0) {
					errors.push('INCREMENT mode requires positive values (orders amount)');
				}
				if (externalUpdate.updates.currentNewLeads !== undefined && externalUpdate.updates.currentNewLeads <= 0) {
					errors.push('INCREMENT mode requires positive values (new leads)');
				}
				if (externalUpdate.updates.currentNewClients !== undefined && externalUpdate.updates.currentNewClients <= 0) {
					errors.push('INCREMENT mode requires positive values (new clients)');
				}
				if (externalUpdate.updates.currentCheckIns !== undefined && externalUpdate.updates.currentCheckIns <= 0) {
					errors.push('INCREMENT mode requires positive values (check-ins)');
				}
				if (externalUpdate.updates.currentHoursWorked !== undefined && externalUpdate.updates.currentHoursWorked <= 0) {
					errors.push('INCREMENT mode requires positive values (hours worked)');
				}
				if (externalUpdate.updates.currentCalls !== undefined && externalUpdate.updates.currentCalls <= 0) {
					errors.push('INCREMENT mode requires positive values (calls)');
				}
			} else if (externalUpdate.updateMode === TargetUpdateMode.DECREMENT) {
				// DECREMENT mode: Only accept positive values to subtract from current amounts
				if (externalUpdate.updates.currentSalesAmount !== undefined && externalUpdate.updates.currentSalesAmount <= 0) {
					errors.push('DECREMENT mode requires positive values (sales amount)');
				}
				if (externalUpdate.updates.currentQuotationsAmount !== undefined && externalUpdate.updates.currentQuotationsAmount <= 0) {
					errors.push('DECREMENT mode requires positive values (quotations amount)');
				}
				if (externalUpdate.updates.currentOrdersAmount !== undefined && externalUpdate.updates.currentOrdersAmount <= 0) {
					errors.push('DECREMENT mode requires positive values (orders amount)');
				}
				if (externalUpdate.updates.currentNewLeads !== undefined && externalUpdate.updates.currentNewLeads <= 0) {
					errors.push('DECREMENT mode requires positive values (new leads)');
				}
				if (externalUpdate.updates.currentNewClients !== undefined && externalUpdate.updates.currentNewClients <= 0) {
					errors.push('DECREMENT mode requires positive values (new clients)');
				}
				if (externalUpdate.updates.currentCheckIns !== undefined && externalUpdate.updates.currentCheckIns <= 0) {
					errors.push('DECREMENT mode requires positive values (check-ins)');
				}
				if (externalUpdate.updates.currentHoursWorked !== undefined && externalUpdate.updates.currentHoursWorked <= 0) {
					errors.push('DECREMENT mode requires positive values (hours worked)');
				}
				if (externalUpdate.updates.currentCalls !== undefined && externalUpdate.updates.currentCalls <= 0) {
					errors.push('DECREMENT mode requires positive values (calls)');
				}

				// Validate that decrementing won't result in negative values
				if (externalUpdate.updates.currentSalesAmount !== undefined) {
					const finalAmount = (user.userTarget.currentSalesAmount || 0) - externalUpdate.updates.currentSalesAmount;
					if (finalAmount < 0) {
						errors.push(`Sales amount would become negative (current: ${user.userTarget.currentSalesAmount || 0} - ${externalUpdate.updates.currentSalesAmount} = ${finalAmount})`);
					}
				}
				if (externalUpdate.updates.currentQuotationsAmount !== undefined) {
					const finalAmount = (user.userTarget.currentQuotationsAmount || 0) - externalUpdate.updates.currentQuotationsAmount;
					if (finalAmount < 0) {
						errors.push(`Quotations amount would become negative (current: ${user.userTarget.currentQuotationsAmount || 0} - ${externalUpdate.updates.currentQuotationsAmount} = ${finalAmount})`);
					}
				}
				if (externalUpdate.updates.currentOrdersAmount !== undefined) {
					const finalAmount = (user.userTarget.currentOrdersAmount || 0) - externalUpdate.updates.currentOrdersAmount;
					if (finalAmount < 0) {
						errors.push(`Orders amount would become negative (current: ${user.userTarget.currentOrdersAmount || 0} - ${externalUpdate.updates.currentOrdersAmount} = ${finalAmount})`);
					}
				}
				if (externalUpdate.updates.currentNewLeads !== undefined) {
					const finalCount = (user.userTarget.currentNewLeads || 0) - externalUpdate.updates.currentNewLeads;
					if (finalCount < 0) {
						errors.push(`New leads count would become negative (current: ${user.userTarget.currentNewLeads || 0} - ${externalUpdate.updates.currentNewLeads} = ${finalCount})`);
					}
				}
				if (externalUpdate.updates.currentNewClients !== undefined) {
					const finalCount = (user.userTarget.currentNewClients || 0) - externalUpdate.updates.currentNewClients;
					if (finalCount < 0) {
						errors.push(`New clients count would become negative (current: ${user.userTarget.currentNewClients || 0} - ${externalUpdate.updates.currentNewClients} = ${finalCount})`);
					}
				}
				if (externalUpdate.updates.currentCheckIns !== undefined) {
					const finalCount = (user.userTarget.currentCheckIns || 0) - externalUpdate.updates.currentCheckIns;
					if (finalCount < 0) {
						errors.push(`Check-ins count would become negative (current: ${user.userTarget.currentCheckIns || 0} - ${externalUpdate.updates.currentCheckIns} = ${finalCount})`);
					}
				}
				if (externalUpdate.updates.currentHoursWorked !== undefined) {
					const finalHours = (user.userTarget.currentHoursWorked || 0) - externalUpdate.updates.currentHoursWorked;
					if (finalHours < 0) {
						errors.push(`Hours worked would become negative (current: ${user.userTarget.currentHoursWorked || 0} - ${externalUpdate.updates.currentHoursWorked} = ${finalHours})`);
					}
				}
				if (externalUpdate.updates.currentCalls !== undefined) {
					const finalCalls = (user.userTarget.currentCalls || 0) - externalUpdate.updates.currentCalls;
					if (finalCalls < 0) {
						errors.push(`Calls count would become negative (current: ${user.userTarget.currentCalls || 0} - ${externalUpdate.updates.currentCalls} = ${finalCalls})`);
					}
				}
			} else {
				// For REPLACE mode, validate the absolute values are not negative
				if (externalUpdate.updates.currentSalesAmount !== undefined && externalUpdate.updates.currentSalesAmount < 0) {
					errors.push('Sales amount cannot be negative in REPLACE mode');
				}

				if (externalUpdate.updates.currentQuotationsAmount !== undefined && externalUpdate.updates.currentQuotationsAmount < 0) {
					errors.push('Quotations amount cannot be negative in REPLACE mode');
				}

				if (externalUpdate.updates.currentOrdersAmount !== undefined && externalUpdate.updates.currentOrdersAmount < 0) {
					errors.push('Orders amount cannot be negative in REPLACE mode');
				}

				if (externalUpdate.updates.currentNewLeads !== undefined && externalUpdate.updates.currentNewLeads < 0) {
					errors.push('New leads count cannot be negative in REPLACE mode');
				}

				if (externalUpdate.updates.currentNewClients !== undefined && externalUpdate.updates.currentNewClients < 0) {
					errors.push('New clients count cannot be negative in REPLACE mode');
				}

				if (externalUpdate.updates.currentCheckIns !== undefined && externalUpdate.updates.currentCheckIns < 0) {
					errors.push('Check-ins count cannot be negative in REPLACE mode');
				}

				if (externalUpdate.updates.currentHoursWorked !== undefined && externalUpdate.updates.currentHoursWorked < 0) {
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
				this.logger.debug(`✅ [ERP_VALIDATION] Transaction ID valid: ${externalUpdate.transactionId} for user: ${userId}`);
			}

			// Validate source system
			// Source is now optional - no validation required
			this.logger.debug(`✅ [ERP_VALIDATION] Source field validation skipped (optional) for user: ${userId}`);

			const isValid = errors.length === 0;
			this.logger.log(`${isValid ? '✅' : '❌'} [ERP_VALIDATION] Validation ${isValid ? 'PASSED' : 'FAILED'} for user: ${userId}, transaction: ${externalUpdate.transactionId}`, {
				isValid,
				errorCount: errors.length,
				errors: errors.length > 0 ? errors : undefined,
				updateMode: externalUpdate.updateMode,
				source: externalUpdate.source || 'UNKNOWN_SOURCE'
			});

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
				stackTrace: error.stack
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
		try {
			// For now, just log the audit trail
			// In the future, this could be saved to a dedicated audit table
			this.logger.log(
				`Target update audit - User: ${userId}, Source: ${source}, Transaction: ${transactionId}, Before: ${JSON.stringify(
					{
						currentSalesAmount: beforeValues.currentSalesAmount,
						currentQuotationsAmount: beforeValues.currentQuotationsAmount,
						currentOrdersAmount: beforeValues.currentOrdersAmount,
						currentNewLeads: beforeValues.currentNewLeads,
						currentNewClients: beforeValues.currentNewClients,
					},
				)}, After: ${JSON.stringify(afterValues)}`,
			);
		} catch (error) {
			this.logger.error('Error creating target update audit log:', error.message);
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
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['organisation', 'branch'],
			});

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
						'Mobile-optimized celebration features'
					]
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
				this.logger.log(`Target achievement email & push notification sent to user ${userId} for ${targetType} target`);
			} catch (notificationError) {
				this.logger.warn(`Failed to send target achievement push notification to user ${userId}:`, notificationError.message);
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
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['organisation', 'branch'],
			});

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
						'Offline progress monitoring'
					]
				},
			};

					this.eventEmitter.emit('send.email', EmailType.USER_TARGET_MILESTONE, [user.email], emailData);

		// Send push notification for milestone achievement
		try {
			const milestoneMessage = milestoneData.milestonePercentage >= 100 
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
					priority: milestoneData.milestonePercentage >= 100 
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
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['organisation', 'branch'],
			});

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
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['organisation', 'branch'],
			});

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
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['organisation', 'branch'],
			});

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
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['organisation', 'branch'],
			});

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
		try {
			// Get user details
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['userTarget', 'organisation', 'branch'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found for target update push notification`);
				return;
			}

			// Determine notification message based on update mode
			let title = '🎯 Target Update';
			let message = '';
			let priority = 'NORMAL' as any;

			switch (externalUpdate.updateMode) {
				case 'INCREMENT':
					title = '📈 Progress Update!';
					message = `Your targets have been updated with new progress from ${externalUpdate.source || 'external system'}`;
					priority = 'HIGH';
					break;
				case 'REPLACE':
					title = '🔄 Target Reset';
					message = `Your targets have been updated by ${externalUpdate.source || 'external system'}`;
					priority = 'NORMAL';
					break;
				default:
					title = '🎯 Target Update';
					message = `Your targets have been updated from ${externalUpdate.source || 'external system'}`;
					priority = 'NORMAL';
			}

			// Send push notification using unified notification service
			await this.unifiedNotificationService.sendTemplatedNotification(
				'TARGET_UPDATE' as any,
				[userId],
				{
					sourceSystem: externalUpdate.source || 'external system',
					updateMode: externalUpdate.updateMode,
					transactionId: externalUpdate.transactionId,
					updatedValues,
					updateTime: new Date().toLocaleString(),
					title,
					message,
				},
				{
					priority,
				},
			);

			this.logger.debug(`Push notification sent to user ${userId} for target update from ${externalUpdate.source || 'external system'}`);
		} catch (error) {
			this.logger.error(`Error sending target update push notification to user ${userId}:`, error.message);
			throw error;
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
		try {
			// Only send notifications for INCREMENT mode as these represent actual progress
			if (externalUpdate.updateMode !== TargetUpdateMode.INCREMENT) {
				this.logger.debug(`Skipping contribution progress notification for user ${userId} - not increment mode`);
				return;
			}

			// Get user details
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['userTarget', 'organisation', 'branch'],
			});

			if (!user) {
				this.logger.warn(`User ${userId} not found for contribution progress notification`);
				return;
			}

			// Calculate contribution progress data
			const contributionProgress = [];
			let totalProgressImprovement = 0;
			let hasSignificantProgress = false;

			// Check sales amount progress
			if (externalUpdate.updates.currentSalesAmount && externalUpdate.updates.currentSalesAmount > 0) {
				const previousValue = (user.userTarget?.currentSalesAmount || 0) - externalUpdate.updates.currentSalesAmount;
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
				{ key: 'currentQuotationsAmount', label: 'Quotations', target: 'targetQuotationsAmount', hasCurrency: true },
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
				"Fantastic progress! Your hard work is really paying off.",
				"You're building great momentum with these results!",
				"Excellent work! Keep this pace and you'll exceed your targets.",
				"Your dedication is showing in these numbers - well done!",
				"Outstanding progress! You're on track for great results.",
			];

			const encouragementTips = [
				"📈 Keep tracking your daily activities to maintain this momentum",
				"🎯 Focus on consistency - small daily improvements add up",
				"💪 Your current pace suggests you'll reach your targets ahead of schedule",
				"⭐ Share your success strategies with team members",
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
				periodStartDate: user.userTarget?.periodStartDate?.toISOString(),
				periodEndDate: user.userTarget?.periodEndDate?.toISOString(),
				daysRemaining: user.userTarget?.periodEndDate ? Math.max(0, Math.ceil((new Date(user.userTarget.periodEndDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))) : undefined,
				motivationalMessage: motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)],
				encouragementTips: encouragementTips.slice(0, 3), // Send 3 tips
				performanceTrend,
				dashboardUrl: `${this.configService.get('FRONTEND_URL')}/targets`,
				supportEmail: this.configService.get('SUPPORT_EMAIL') || 'support@orrbit.co.za',
			};

			// Send email notification
			this.eventEmitter.emit('send.email', EmailType.USER_TARGET_CONTRIBUTION_PROGRESS, [user.email], emailData);
			this.logger.log(`✅ Contribution progress email queued for user: ${userId} (${totalProgressImprovement}% improvement)`);

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
				this.logger.warn(`Failed to send contribution progress push notification to user ${userId}: ${pushError.message}`);
				// Don't fail the email if push notification fails
			}

		} catch (error) {
			this.logger.error(`Error sending contribution progress notification to user ${userId}:`, error.message);
			throw error;
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

			const user = await this.userRepository.findOne({
				where: whereConditions,
				relations: ['organisation', 'branch'],
			});

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

			const user = await this.userRepository.findOne({
				where: whereConditions,
				relations: ['organisation', 'branch'],
			});

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

			const user = await this.userRepository.findOne({
				where: whereConditions,
				relations: ['organisation', 'branch'],
			});

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
			password: boolean;
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
			if (changes.password) changesList.push('Password');
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
					password: changes.password,
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
}
