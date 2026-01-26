import { BadRequestException, Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { Repository } from 'typeorm';
import { CheckIn } from './entities/check-in.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateCheckOutDto } from './dto/create-check-out.dto';
import { differenceInMinutes, differenceInHours } from 'date-fns';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { User } from 'src/user/entities/user.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationPriority, NotificationEvent, NotificationChannel } from '../lib/types/unified-notification.types';
import { AccessLevel } from 'src/lib/enums/user.enums';
import { GoogleMapsService } from '../lib/services/google-maps.service';

@Injectable()
export class CheckInsService {
	private readonly logger = new Logger(CheckInsService.name);
	private readonly CACHE_PREFIX = 'checkins:';
	private readonly CACHE_TTL: number;

	constructor(
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		private rewardsService: RewardsService,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly googleMapsService: GoogleMapsService,
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default
	}

	/**
	 * Resolves Clerk org ID (string) to organisation numeric uid.
	 * Looks up by clerkOrgId or ref. Returns null if not found.
	 */
	private async resolveOrgId(clerkOrgId?: string): Promise<number | null> {
		if (!clerkOrgId) {
			return null;
		}
		const org = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId, isDeleted: false },
				{ ref: clerkOrgId, isDeleted: false },
			],
			select: ['uid'],
		});
		return org?.uid ?? null;
	}

	async checkIn(createCheckInDto: CreateCheckInDto, orgId?: string, branchId?: number, clerkUserId?: string): Promise<{ message: string; checkInId?: number }> {
		const operationId = `checkin_${Date.now()}`;
		const startTime = Date.now();
		const ownerRef = (createCheckInDto as { owner?: { uid: string } }).owner?.uid;
		this.logger.log(
			`[${operationId}] Check-in attempt for user: ${ownerRef ?? clerkUserId ?? 'unknown'}, orgId: ${orgId}, branchId: ${branchId}, clerkUserId: ${clerkUserId}`,
		);

		try {
			// ============================================================
			// CRITICAL PATH: Operations that must complete before response
			// ============================================================

			// Require either owner.uid (legacy) or clerkUserId from token (self check-in)
			if (!ownerRef && !clerkUserId) {
				this.logger.error(`[${operationId}] User ID or Clerk ID is required for check-in`);
				throw new BadRequestException('User ID or Clerk ID is required for check-in');
			}

			if (!orgId) {
				this.logger.error(`[${operationId}] Organization ID is required for check-in`);
				throw new BadRequestException('Organization ID is required');
			}

			// Resolve user: by clerkUserId (token) or by owner.uid (DTO, string)
			let user: User | null = null;
			if (clerkUserId) {
				user = await this.userRepository.findOne({
					where: { clerkUserId },
					relations: ['organisation', 'branch'],
				});
			}
			if (!user && ownerRef) {
				const userWhere = typeof ownerRef === 'string' && ownerRef.startsWith('user_')
					? { clerkUserId: ownerRef }
					: { uid: Number(ownerRef) };
				user = await this.userRepository.findOne({
					where: userWhere,
					relations: ['organisation', 'branch'],
				});
			}

			if (!user) {
				const ref = ownerRef ?? clerkUserId;
				this.logger.error(`[${operationId}] User not found: ${ref}`);
				throw new NotFoundException('User not found');
			}

			// Validate user belongs to the organization using Clerk org ID (organisationRef)
			if (user.organisationRef && user.organisationRef !== orgId) {
				this.logger.error(
					`[${operationId}] User ${user.uid} belongs to org ${user.organisationRef}, not ${orgId}`,
				);
				throw new BadRequestException('User does not belong to the specified organization');
			}

			// Resolve branch information from multiple sources (prefer DTO > parameter > user relation)
			const resolvedBranchId = createCheckInDto?.branch?.uid ?? branchId ?? user.branch?.uid;
			let branchSource = 'unknown';
			if (createCheckInDto?.branch?.uid) {
				branchSource = 'DTO';
			} else if (branchId) {
				branchSource = 'parameter';
			} else if (user.branch?.uid) {
				branchSource = 'user relation';
			}

			// Log branch resolution (branch is optional)
			if (resolvedBranchId) {
				this.logger.debug(`[${operationId}] Branch resolved from ${branchSource}: ${resolvedBranchId}`);
			} else {
				this.logger.debug(`[${operationId}] No branch information provided - check-in will be saved without branch`);
			}

			// Enhanced data mapping with proper organization filtering
			this.logger.debug(`[${operationId}] Creating check-in record with enhanced data mapping`);
			
			// Prefer clerkUserId from token, then user's clerkUserId from database
			const resolvedClerkUserId = clerkUserId || user.clerkUserId;
			if (!resolvedClerkUserId) {
				this.logger.error(`[${operationId}] No clerkUserId available - cannot set ownerClerkUserId`);
				throw new BadRequestException('User Clerk ID is required for check-in');
			}

			const checkInData: any = {
				...createCheckInDto,
				checkInTime: createCheckInDto.checkInTime ? new Date(createCheckInDto.checkInTime) : new Date(),
				// Set owner relation using clerkUserId (not uid) to ensure ownerClerkUserId is set correctly
				owner: {
					clerkUserId: resolvedClerkUserId,
				} as User,
				ownerClerkUserId: resolvedClerkUserId, // Explicitly set the foreign key column
				organisation: {
					clerkOrgId: orgId, // Use Clerk org ID string for relation
				} as Organisation,
				organisationUid: orgId, // Clerk org ID string - key relationship identifier
			};

			// Log when setting ownerClerkUserId and organisationUid for debugging
			this.logger.debug(`[${operationId}] Setting ownerClerkUserId: ${resolvedClerkUserId}`);
			if (orgId) {
				this.logger.debug(`[${operationId}] Setting organisationUid: ${orgId}`);
			}

			// Only set branch and branchUid if branchId is provided
			if (resolvedBranchId) {
				checkInData.branch = { uid: resolvedBranchId };
				checkInData.branchUid = resolvedBranchId;
			} else {
				// Explicitly set to null for TypeORM (handles null better than undefined)
				checkInData.branch = null;
				checkInData.branchUid = null;
			}

			// Core operation: Save check-in to database
			const checkIn = await this.checkInRepository.save(checkInData);

			if (!checkIn) {
				this.logger.error(`[${operationId}] Failed to create check-in record - database returned null`);
				throw new BadRequestException('Failed to create check-in record');
			}

			this.logger.debug(`[${operationId}] Check-in record created successfully with ID: ${checkIn.uid}`);

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful save
			// ============================================================
			const duration = Date.now() - startTime;
			this.logger.log(
				`✅ [${operationId}] Check-in successful for user: ${user.clerkUserId ?? user.uid} in ${duration}ms - returning response to client`,
			);

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Check-in recorded successfully',
				checkInId: checkIn.uid,
			};

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					this.logger.debug(`🔄 [${operationId}] Starting post-response processing for check-in: ${checkIn.uid}`);

					// 1. Update client GPS coordinates if client is provided
					if (createCheckInDto.client && createCheckInDto.client.uid) {
						try {
							this.logger.debug(`[${operationId}] Updating client ${createCheckInDto.client.uid} GPS coordinates`);
							await this.clientRepository.update(
								{ uid: createCheckInDto.client.uid },
								{ gpsCoordinates: createCheckInDto.checkInLocation },
							);
							this.logger.debug(`✅ [${operationId}] Client GPS coordinates updated successfully`);
						} catch (clientError) {
							this.logger.error(
								`❌ [${operationId}] Failed to update client GPS coordinates: ${clientError.message}`,
								clientError.stack,
							);
							// Don't fail post-processing if client update fails
						}
					}

					// 2. Send check-in notifications
					try {
						this.logger.debug(`[${operationId}] Sending check-in notifications`);
						await this.sendCheckInNotifications(user.uid, checkIn, user.name, orgId, branchId);
						this.logger.debug(`✅ [${operationId}] Check-in notifications sent successfully`);
					} catch (notificationError) {
						this.logger.error(
							`❌ [${operationId}] Failed to send check-in notifications: ${notificationError.message}`,
							notificationError.stack,
						);
						// Don't fail post-processing if notifications fail
					}

					// 3. Award XP with enhanced error handling (use clerk id when available per migration)
					try {
						this.logger.debug(`[${operationId}] Awarding XP for check-in to user: ${user.clerkUserId ?? user.uid}`);
						await this.rewardsService.awardXP(
							{
								owner: user.clerkUserId ?? user.uid,
								amount: XP_VALUES.CHECK_IN_CLIENT,
								action: XP_VALUES_TYPES.CHECK_IN_CLIENT,
								source: {
									id: user.clerkUserId ?? String(user.uid),
									type: XP_VALUES_TYPES.CHECK_IN_CLIENT,
									details: 'Check-in reward',
								},
							},
							orgId,
							branchId,
						);
						this.logger.debug(
							`✅ [${operationId}] XP awarded successfully for check-in to user: ${user.clerkUserId ?? user.uid}`,
						);
					} catch (xpError) {
						this.logger.error(
							`❌ [${operationId}] Failed to award XP for check-in to user: ${user.clerkUserId ?? user.uid}`,
							xpError.stack,
						);
						// Don't fail post-processing if XP award fails
					}

					this.logger.debug(`✅ [${operationId}] Post-response processing completed for check-in: ${checkIn.uid}`);
				} catch (backgroundError) {
					// Log errors but don't affect user experience since response already sent
					this.logger.error(
						`❌ [${operationId}] Background processing failed for check-in ${checkIn.uid}: ${backgroundError.message}`,
						backgroundError.stack,
					);
				}
			});

			return response;
		} catch (error) {
			this.logger.error(`[${operationId}] Check-in failed for user: ${ownerRef ?? clerkUserId ?? 'unknown'}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Send check-in notifications to user and admins
	 */
	private async sendCheckInNotifications(
		userId: number,
		checkIn: CheckIn,
		userName: string,
		orgId?: string,
		branchId?: number,
	): Promise<void> {
		const operationId = `checkin_notifications_${Date.now()}`;

		try {
			// Build detailed location string
			const locationDetails = checkIn.client?.name 
				? `${checkIn.client.name}` 
				: 'a location';
			
			const coordinatesInfo = checkIn.checkInLocation 
				? ` (${checkIn.checkInLocation})` 
				: '';

			// Send detailed notification to the user
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.CHECKIN_CREATED,
				[userId],
				{
					userName: userName,
					clientName: checkIn.client?.name || 'Location',
					checkInId: checkIn.uid,
					checkInTime: checkIn.checkInTime,
					location: locationDetails,
					coordinates: checkIn.checkInLocation,
					orgId,
					branchId,
					timestamp: new Date().toISOString(),
					checkInDetails: {
						id: checkIn.uid,
						userId: userId,
						userName: userName,
						clientName: checkIn.client?.name || 'Location',
						clientId: checkIn.client?.uid,
						checkInTime: checkIn.checkInTime,
						location: checkIn.checkInLocation,
						notes: checkIn.notes,
						createdAt: checkIn.createdAt?.toISOString(),
						orgId,
						branchId,
					},
				},
				{ 
					priority: NotificationPriority.NORMAL,
					customData: {
						screen: '/checkins',
						action: 'view_checkin',
						checkInId: checkIn.uid,
						clientId: checkIn.client?.uid,
					},
				},
			);

			// If organization ID is provided, notify admins
			if (orgId) {
				const orgAdmins = await this.getOrganizationAdmins(orgId);
				if (orgAdmins.length > 0) {
					// Send detailed notification to admins
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_SHIFT_STARTED,
						orgAdmins.map(admin => admin.uid),
						{
							userName: userName,
							clientName: checkIn.client?.name || 'Location',
							checkInId: checkIn.uid,
							checkInTime: checkIn.checkInTime,
							location: locationDetails,
							coordinates: checkIn.checkInLocation,
							orgId,
							branchId,
							timestamp: new Date().toISOString(),
							adminNotification: true,
							checkInDetails: {
								id: checkIn.uid,
								userId: userId,
								userName: userName,
								clientName: checkIn.client?.name || 'Location',
								clientId: checkIn.client?.uid,
								checkInTime: checkIn.checkInTime,
								location: checkIn.checkInLocation,
								notes: checkIn.notes,
								createdAt: checkIn.createdAt?.toISOString(),
								orgId,
								branchId,
							},
						},
						{
							priority: NotificationPriority.LOW,
							customData: {
								screen: '/checkins',
								action: 'view_checkin',
								checkInId: checkIn.uid,
								clientId: checkIn.client?.uid,
								userId: userId,
								adminContext: true,
							},
						},
					);
				}
			}
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to send check-in notifications:`, error.stack);
			throw error;
		}
	}

	/**
	 * Get organization admins for notifications
	 */
	private async getOrganizationAdmins(orgId: string): Promise<any[]> {
		try {
			const adminUsers = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.accessLevel = :accessLevel', { accessLevel: AccessLevel.ADMIN })
				.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
				.select(['user.uid', 'user.email'])
				.getMany();
			return adminUsers;
		} catch (error) {
			this.logger.error(`Error fetching org admins for org ${orgId}:`, error.message);
			return [];
		}
	}

	/**
	 * Send check-out notifications to user and admins
	 */
	private async sendCheckOutNotifications(
		userId: number,
		checkIn: CheckIn,
		duration: string,
		userName: string,
		fullAddress: string,
		orgId?: string,
		branchId?: number,
	): Promise<void> {
		const operationId = `checkout_notifications_${Date.now()}`;

		try {
			// Build detailed location string
			const locationDetails = checkIn.client?.name 
				? `${checkIn.client.name}` 
				: 'a location';
			
			// Include full address if available, otherwise use coordinates
			const addressInfo = fullAddress 
				? ` at ${fullAddress}` 
				: checkIn.checkOutLocation 
					? ` (${checkIn.checkOutLocation})` 
					: '';

			// Send detailed notification to the user using CHECKOUT_COMPLETED template
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.CHECKOUT_COMPLETED,
				[Number(userId)],
				{
					userName: userName,
					clientName: checkIn.client?.name || 'Location',
					duration: duration,
					checkInId: checkIn.uid,
					checkOutTime: checkIn.checkOutTime,
					location: locationDetails,
					address: fullAddress,
					orgId,
					branchId,
					timestamp: new Date().toISOString(),
					checkOutDetails: {
						id: checkIn.uid,
						userId: userId,
						userName: userName,
						clientName: checkIn.client?.name || 'Location',
						clientId: checkIn.client?.uid,
						checkInTime: checkIn.checkInTime,
						checkOutTime: checkIn.checkOutTime,
						duration: duration,
						location: checkIn.checkOutLocation,
						address: fullAddress,
						notes: checkIn.notes,
						createdAt: checkIn.createdAt?.toISOString(),
						updatedAt: checkIn.updatedAt?.toISOString(),
						orgId,
						branchId,
					},
				},
				{ 
					priority: NotificationPriority.NORMAL,
					customData: {
						screen: '/checkins',
						action: 'view_checkin',
						checkInId: checkIn.uid,
						clientId: checkIn.client?.uid,
					},
				},	
			);

			// If organization ID is provided, notify admins
			if (orgId) {
				const orgAdmins = await this.getOrganizationAdmins(orgId);
				if (orgAdmins.length > 0) {
					// Send detailed notification to admins
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_SHIFT_ENDED,
						orgAdmins.map(admin => admin.uid),
						{
							userName: userName,
							clientName: checkIn.client?.name || 'Location',
							duration: duration,
							workTimeDisplay: duration, // Add workTimeDisplay for template compatibility
							checkInId: checkIn.uid,
							checkInTime: checkIn.checkInTime, // Add missing checkInTime
							checkOutTime: checkIn.checkOutTime,
							location: locationDetails,
							address: fullAddress,
							orgId,
							branchId,
							timestamp: new Date().toISOString(),
							adminNotification: true,
							checkOutDetails: {
								id: checkIn.uid,
								userId: userId,
								userName: userName,
								clientName: checkIn.client?.name || 'Location',
								clientId: checkIn.client?.uid,
								checkInTime: checkIn.checkInTime,
								checkOutTime: checkIn.checkOutTime,
								duration: duration,
								location: checkIn.checkOutLocation,
								address: fullAddress,
								notes: checkIn.notes,
								createdAt: checkIn.createdAt?.toISOString(),
								updatedAt: checkIn.updatedAt?.toISOString(),
								orgId,
								branchId,
							},
						},
						{
							priority: NotificationPriority.LOW,
							customData: {
								screen: '/checkins',
								action: 'view_checkin',
								checkInId: checkIn.uid,
								clientId: checkIn.client?.uid,
								userId: userId,
								adminContext: true,
							},
						},
					);
				}
			}
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to send check-out notifications:`, error.stack);
			throw error;
		}
	}

	async checkOut(
		createCheckOutDto: CreateCheckOutDto,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
	): Promise<{ message: string; duration?: string; checkInId?: number }> {
		const operationId = `checkout_${Date.now()}`;
		const startTime = Date.now();
		const ownerRef = (createCheckOutDto as { owner?: { uid: string } }).owner?.uid;
		this.logger.log(
			`[${operationId}] Check-out attempt for user: ${ownerRef ?? clerkUserId ?? 'unknown'}, orgId: ${orgId}, branchId: ${branchId}, clerkUserId: ${clerkUserId}`,
		);

		try {
			// ============================================================
			// CRITICAL PATH: Operations that must complete before response
			// ============================================================

			// Require owner (legacy) or clerkUserId from token
			this.logger.debug(`[${operationId}] Validating check-out data`);
			if (!ownerRef && !clerkUserId) {
				this.logger.error(`[${operationId}] Owner or Clerk ID is required for check-out`);
				throw new BadRequestException(process.env.NOT_FOUND_MESSAGE);
			}

			if (!createCheckOutDto?.branch) {
				this.logger.error(`[${operationId}] Branch information is required for check-out`);
				throw new BadRequestException(process.env.NOT_FOUND_MESSAGE);
			}

			// Resolve user by clerkUserId or owner.uid (string)
			let user: User | null = null;
			if (clerkUserId) {
				user = await this.userRepository.findOne({
					where: { clerkUserId },
					select: ['uid', 'clerkUserId', 'name'],
				});
			}
			if (!user && ownerRef) {
				const userWhere = typeof ownerRef === 'string' && ownerRef.startsWith('user_')
					? { clerkUserId: ownerRef }
					: { uid: Number(ownerRef) };
				user = await this.userRepository.findOne({
					where: userWhere,
					select: ['uid', 'clerkUserId', 'name'],
				});
			}
			if (!user) {
				this.logger.error(`[${operationId}] User not found: ${ownerRef ?? clerkUserId}`);
				throw new NotFoundException('User not found');
			}

			const clerkId = user.clerkUserId;
			this.logger.debug(`[${operationId}] Finding active check-in for user: ${clerkId}`);
			const checkIn = await this.checkInRepository.findOne({
				where: { ownerClerkUserId: clerkId },
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch'],
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] No active check-in found for user: ${clerkId}`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			if (checkIn.checkOutTime) {
				this.logger.warn(`[${operationId}] User ${clerkId} has already checked out`);
				throw new BadRequestException('User has already checked out');
			}

			this.logger.debug(`[${operationId}] Found active check-in with ID: ${checkIn.uid}, calculating duration`);

			// Calculate duration (needed for response)
			const checkOutTime = new Date(createCheckOutDto.checkOutTime);
			const checkInTime = new Date(checkIn.checkInTime);

			const minutesWorked = differenceInMinutes(checkOutTime, checkInTime);
			const hoursWorked = differenceInHours(checkOutTime, checkInTime);
			const remainingMinutes = minutesWorked % 60;

			const duration = `${hoursWorked}h ${remainingMinutes}m`;
			this.logger.debug(
				`[${operationId}] Calculated work duration: ${duration} (${minutesWorked} minutes total)`,
			);

			// Core operation: Update check-in record with check-out data (without fullAddress - will be updated later)
			this.logger.debug(`[${operationId}] Updating check-in record with check-out data`);

			const updateData: any = {
				checkOutTime: createCheckOutDto?.checkOutTime,
				checkOutPhoto: createCheckOutDto?.checkOutPhoto,
				checkOutLocation: createCheckOutDto?.checkOutLocation,
				duration: duration,
				// fullAddress will be updated in post-response processing
			};

			// Preserve or set ownerClerkUserId and organisationUid
			// Use existing values if present, otherwise set from parameters
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			} else {
				this.logger.warn(`[${operationId}] Warning: No ownerClerkUserId available - existing value is missing and clerkUserId not provided`);
			}

			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			} else {
				this.logger.warn(`[${operationId}] Warning: No organisationUid available - existing value is missing and orgId not provided`);
			}

			// Add optional fields if provided
			if (createCheckOutDto?.notes !== undefined) {
				updateData.notes = createCheckOutDto.notes;
			}
			if (createCheckOutDto?.resolution !== undefined) {
				updateData.resolution = createCheckOutDto.resolution;
			}
			if (createCheckOutDto?.client?.uid !== undefined) {
				updateData.client = { uid: createCheckOutDto.client.uid };
			}

			await this.checkInRepository.update(checkIn.uid, updateData);

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful update
			// ============================================================
			const durationMs = Date.now() - startTime;
			this.logger.log(
				`✅ [${operationId}] Check-out successful for user: ${clerkId} in ${durationMs}ms - returning response to client`,
			);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				duration: duration,
				checkInId: checkIn.uid,
			};

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					this.logger.debug(`🔄 [${operationId}] Starting post-response processing for check-out: ${checkIn.uid}`);

					// 1. Reverse geocode the check-in location to get full address
					let fullAddress = null;
					try {
						this.logger.debug(`[${operationId}] Reverse geocoding check-in location: ${checkIn.checkInLocation}`);
						
						// Parse coordinates from checkInLocation based on DTO format: "latitude, longitude"
						const coordinateStr = checkIn.checkInLocation?.trim();
						if (!coordinateStr) {
							this.logger.warn(`[${operationId}] Empty check-in location provided`);
						} else {
							// Split by comma and handle various spacing
							const coords = coordinateStr.split(',').map(coord => coord.trim());
							
							if (coords.length !== 2) {
								this.logger.warn(`[${operationId}] Invalid coordinate format - expected 'latitude, longitude': ${checkIn.checkInLocation}`);
							} else {
								const latitude = parseFloat(coords[0]);
								const longitude = parseFloat(coords[1]);

								// Validate coordinate ranges
								if (isNaN(latitude) || isNaN(longitude)) {
									this.logger.warn(`[${operationId}] Non-numeric coordinates provided: lat=${coords[0]}, lng=${coords[1]}`);
								} else if (latitude < -90 || latitude > 90) {
									this.logger.warn(`[${operationId}] Invalid latitude (must be -90 to 90): ${latitude}`);
								} else if (longitude < -180 || longitude > 180) {
									this.logger.warn(`[${operationId}] Invalid longitude (must be -180 to 180): ${longitude}`);
								} else {
									const geocodingResult = await this.googleMapsService.reverseGeocode({ latitude, longitude });
									fullAddress = geocodingResult.address;
									this.logger.debug(`✅ [${operationId}] Successfully geocoded address: ${geocodingResult.formattedAddress}`);

									// Update check-in record with full address
									await this.checkInRepository.update(checkIn.uid, {
										fullAddress: fullAddress,
									});
									this.logger.debug(`✅ [${operationId}] Updated check-in record with full address`);
								}
							}
						}
					} catch (geocodingError) {
						this.logger.error(
							`❌ [${operationId}] Failed to reverse geocode check-in location: ${geocodingError.message}`,
							geocodingError.stack,
						);
						// Don't fail post-processing if geocoding fails
					}

					// 2. Fetch updated check-in with relations for notifications
					const updatedCheckIn = await this.checkInRepository.findOne({
						where: { uid: checkIn.uid },
						relations: ['owner', 'client', 'branch'],
					});

					if (!updatedCheckIn) {
						this.logger.warn(`⚠️ [${operationId}] Could not fetch updated check-in ${checkIn.uid} for post-processing`);
						return;
					}

					// 3. Send check-out notifications (use resolved user)
					try {
						this.logger.debug(`[${operationId}] Sending check-out notifications`);
						const userName = updatedCheckIn.owner?.name || 'Staff member';
						await this.sendCheckOutNotifications(
							user.uid,
							updatedCheckIn,
							duration,
							userName,
							fullAddress,
							orgId,
							branchId,
						);
						this.logger.debug(`✅ [${operationId}] Check-out notifications sent successfully`);
					} catch (notificationError) {
						this.logger.error(
							`❌ [${operationId}] Failed to send check-out notifications: ${notificationError.message}`,
							notificationError.stack,
						);
						// Don't fail post-processing if notifications fail
					}

					// 4. Award XP with enhanced error handling (use clerk id when available per migration)
					try {
						this.logger.debug(`[${operationId}] Awarding XP for check-out to user: ${clerkId}`);
						await this.rewardsService.awardXP(
							{
								owner: user.clerkUserId ?? user.uid,
								amount: 10,
								action: 'CHECK_OUT',
								source: {
									id: user.clerkUserId ?? String(user.uid),
									type: 'check-in',
									details: 'Check-out reward',
								},
							},
							orgId,
							branchId,
						);
						this.logger.debug(
							`✅ [${operationId}] XP awarded successfully for check-out to user: ${clerkId}`,
						);
					} catch (xpError) {
						this.logger.error(
							`❌ [${operationId}] Failed to award XP for check-out to user: ${clerkId}`,
							xpError.stack,
						);
						// Don't fail post-processing if XP award fails
					}

					this.logger.debug(`✅ [${operationId}] Post-response processing completed for check-out: ${checkIn.uid}`);
				} catch (backgroundError) {
					// Log errors but don't affect user experience since response already sent
					this.logger.error(
						`❌ [${operationId}] Background processing failed for check-out ${checkIn.uid}: ${backgroundError.message}`,
						backgroundError.stack,
					);
				}
			});

			return response;
		} catch (error) {
			this.logger.error(
				`[${operationId}] Check-out failed for user: ${ownerRef ?? clerkUserId ?? 'unknown'}`,
				error.stack,
			);
			return {
				message: error?.message,
				duration: null,
			};
		}
	}

	async checkInStatus(reference: string): Promise<any> {
		try {
			// Reference can be clerk id (user_xxx) or numeric string; filter by ownerClerkUserId
			const whereClause = reference.startsWith('user_')
				? { ownerClerkUserId: reference }
				: { owner: { uid: Number(reference) } };
			const [checkIn] = await this.checkInRepository.find({
				where: whereClause,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client'],
			});

			if (!checkIn) {
				throw new NotFoundException('Check-in not found');
			}

			const nextAction =
				checkIn.checkInTime && checkIn.checkInLocation && !checkIn.checkOutTime ? 'checkOut' : 'checkIn';

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				nextAction,
				checkedIn: nextAction === 'checkOut',
				...checkIn,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				nextAction: 'Check In',
				checkedIn: false,
			};

			return response;
		}
	}

	async getAllCheckIns(organizationUid?: string): Promise<any> {
		try {
			const whereCondition: any = {};

			if (organizationUid) {
				// organisationUid is now a string (Clerk org ID), filter directly
				whereCondition.organisationUid = organizationUid;
			}

			const checkIns = await this.checkInRepository.find({
				where: whereCondition,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch', 'organisation'],
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				checkIns: [],
			};

			return response;
		}
	}

	async getUserCheckIns(userUid: string, organizationUid?: string): Promise<any> {
		try {
			// Use ownerClerkUserId if it's a Clerk ID, otherwise use uid (string coercion)
			const whereCondition: any = userUid.startsWith('user_')
				? { ownerClerkUserId: userUid }
				: { owner: { uid: userUid } };

			if (organizationUid) {
				// organisationUid is now a string (Clerk org ID), filter directly
				whereCondition.organisationUid = organizationUid;
			}

			const checkIns = await this.checkInRepository.find({
				where: whereCondition,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch', 'organisation'],
			});

			if (!checkIns || checkIns.length === 0) {
				const response = {
					message: process.env.SUCCESS_MESSAGE,
					checkIns: [],
					user: null,
				};
				return response;
			}

			// Get user info from the first check-in record
			const userInfo = checkIns[0]?.owner || null;

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns,
				user: userInfo,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				checkIns: [],
				user: null,
			};

			return response;
		}
	}

	/**
	 * Fast update endpoint for check-in photo URL
	 * Used after background upload completes
	 */
	async updateCheckInPhoto(
		checkInId: number,
		photoUrl: string,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
	): Promise<{ message: string }> {
		const operationId = `update_checkin_photo_${Date.now()}`;
		const startTime = Date.now();
		this.logger.log(`[${operationId}] Updating check-in photo for check-in: ${checkInId}`);

		try {
			// Find check-in record
			const checkIn = await this.checkInRepository.findOne({
				where: { uid: checkInId },
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] Check-in not found: ${checkInId}`);
				throw new NotFoundException('Check-in not found');
			}

			// Build update data, preserving or setting ownerClerkUserId and organisationUid
			const updateData: any = {
				checkInPhoto: photoUrl,
			};

			// Preserve or set ownerClerkUserId
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			}

			// Preserve or set organisationUid
			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			}

			// Update photo URL and preserve/set relationship keys
			await this.checkInRepository.update(checkInId, updateData);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [${operationId}] Check-in photo updated successfully in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Check-in photo updated successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ [${operationId}] Failed to update check-in photo after ${duration}ms: ${error.message}`,
				error.stack,
			);
			return {
				message: error?.message || 'Failed to update check-in photo',
			};
		}
	}

	/**
	 * Fast update endpoint for check-out photo URL
	 * Used after background upload completes
	 */
	async updateCheckOutPhoto(
		checkInId: number,
		photoUrl: string,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
	): Promise<{ message: string }> {
		const operationId = `update_checkout_photo_${Date.now()}`;
		const startTime = Date.now();
		this.logger.log(`[${operationId}] Updating check-out photo for check-in: ${checkInId}`);

		try {
			// Find check-in record
			const checkIn = await this.checkInRepository.findOne({
				where: { uid: checkInId },
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] Check-in not found: ${checkInId}`);
				throw new NotFoundException('Check-in not found');
			}

			// Build update data, preserving or setting ownerClerkUserId and organisationUid
			const updateData: any = {
				checkOutPhoto: photoUrl,
			};

			// Preserve or set ownerClerkUserId
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			}

			// Preserve or set organisationUid
			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			}

			// Update photo URL and preserve/set relationship keys
			await this.checkInRepository.update(checkInId, updateData);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [${operationId}] Check-out photo updated successfully in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Check-out photo updated successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ [${operationId}] Failed to update check-out photo after ${duration}ms: ${error.message}`,
				error.stack,
			);
			return {
				message: error?.message || 'Failed to update check-out photo',
			};
		}
	}

	/**
	 * Update visit details (client, notes, resolution) after check-out
	 */
	async updateVisitDetails(
		checkInId: number,
		clientId?: number,
		notes?: string,
		resolution?: string,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
	): Promise<{ message: string }> {
		const operationId = `update_visit_details_${Date.now()}`;
		const startTime = Date.now();
		this.logger.log(`[${operationId}] Updating visit details for check-in: ${checkInId}`);

		try {
			// Find check-in record
			const checkIn = await this.checkInRepository.findOne({
				where: { uid: checkInId },
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] Check-in not found: ${checkInId}`);
				throw new NotFoundException('Check-in not found');
			}

			// Build update data
			const updateData: any = {};
			if (clientId !== undefined) {
				updateData.client = { uid: clientId };
			}
			if (notes !== undefined) {
				updateData.notes = notes;
			}
			if (resolution !== undefined) {
				updateData.resolution = resolution;
			}

			// Preserve or set ownerClerkUserId
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			}

			// Preserve or set organisationUid
			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			}

			// Update visit details and preserve/set relationship keys
			await this.checkInRepository.update(checkInId, updateData);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [${operationId}] Visit details updated successfully in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Visit details updated successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ [${operationId}] Failed to update visit details after ${duration}ms: ${error.message}`,
				error.stack,
			);
			return {
				message: error?.message || 'Failed to update visit details',
			};
		}
	}
}
