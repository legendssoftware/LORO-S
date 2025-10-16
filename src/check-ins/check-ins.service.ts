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
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly googleMapsService: GoogleMapsService,
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default

		this.logger.log('CheckInsService initialized with cache TTL: ' + this.CACHE_TTL + 'ms');
		this.logger.debug(`CheckInsService initialized with dependencies:`);
		this.logger.debug(`CheckIn Repository: ${!!this.checkInRepository}`);
		this.logger.debug(`User Repository: ${!!this.userRepository}`);
		this.logger.debug(`Client Repository: ${!!this.clientRepository}`);
		this.logger.debug(`Rewards Service: ${!!this.rewardsService}`);
		this.logger.debug(`Cache Manager: ${!!this.cacheManager}`);
		this.logger.debug(`Unified Notification Service: ${!!this.unifiedNotificationService}`);
		this.logger.debug(`Google Maps Service: ${!!this.googleMapsService}`);
	}

	async checkIn(createCheckInDto: CreateCheckInDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const operationId = `checkin_${Date.now()}`;
		this.logger.log(
			`[${operationId}] Check-in attempt for user: ${createCheckInDto.owner?.uid}, orgId: ${orgId}, branchId: ${branchId}`,
		);

		try {
			// Enhanced validation
			this.logger.debug(`[${operationId}] Validating check-in data`);
			if (!createCheckInDto?.owner?.uid) {
				this.logger.error(`[${operationId}] User ID is required for check-in`);
				throw new BadRequestException('User ID is required for check-in');
			}

			if (!orgId) {
				this.logger.error(`[${operationId}] Organization ID is required for check-in`);
				throw new BadRequestException('Organization ID is required');
			}

			// Validate user belongs to the organization
			this.logger.debug(
				`[${operationId}] Validating user ${createCheckInDto.owner.uid} belongs to organization ${orgId}`,
			);
			const user = await this.userRepository.findOne({
				where: { uid: createCheckInDto.owner.uid },
				relations: ['organisation', 'branch'],
			});

			if (!user) {
				this.logger.error(`[${operationId}] User not found with ID: ${createCheckInDto.owner.uid}`);
				throw new NotFoundException('User not found');
			}

			if (user.organisation?.uid !== orgId) {
				this.logger.error(
					`[${operationId}] User ${createCheckInDto.owner.uid} belongs to org ${user.organisation?.uid}, not ${orgId}`,
				);
				throw new BadRequestException('User does not belong to the specified organization');
			}

			this.logger.debug(
				`[${operationId}] User validated: ${user.email} (${user.name}) in organization: ${orgId}`,
			);

			// Validate branch information
			if (!createCheckInDto?.branch?.uid) {
				this.logger.error(`[${operationId}] Branch information is required for check-in`);
				throw new BadRequestException('Branch information is required');
			}

			// Enhanced data mapping with proper organization filtering
			this.logger.debug(`[${operationId}] Creating check-in record with enhanced data mapping`);
			const checkInData = {
				...createCheckInDto,
				organization: {
					uid: orgId, // Use the validated orgId instead of user's org
				},
				branch: {
					uid: branchId || createCheckInDto.branch.uid,
				},
			};

			const checkIn = await this.checkInRepository.save(checkInData);

			if (!checkIn) {
				this.logger.error(`[${operationId}] Failed to create check-in record - database returned null`);
				throw new BadRequestException('Failed to create check-in record');
			}

			this.logger.debug(`[${operationId}] Check-in record created successfully with ID: ${checkIn.uid}`);

			// Update client GPS coordinates if client is provided
			if (createCheckInDto.client && createCheckInDto.client.uid) {
				this.logger.debug(`[${operationId}] Updating client ${createCheckInDto.client.uid} GPS coordinates`);
				try {
					await this.clientRepository.update(
						{ uid: createCheckInDto.client.uid },
						{ gpsCoordinates: createCheckInDto.checkInLocation },
					);
					this.logger.debug(`[${operationId}] Client GPS coordinates updated successfully`);
				} catch (clientError) {
					this.logger.error(
						`[${operationId}] Failed to update client GPS coordinates: ${clientError.message}`,
					);
					// Don't fail the check-in if client update fails
				}
			}

			// Send check-in notifications
			try {
				this.logger.debug(`[${operationId}] Sending check-in notifications`);
				await this.sendCheckInNotifications(createCheckInDto.owner.uid, checkIn, user.name, orgId, branchId);
				this.logger.debug(`[${operationId}] Check-in notifications sent successfully`);
			} catch (notificationError) {
				this.logger.warn(
					`[${operationId}] Failed to send check-in notifications: ${notificationError.message}`,
				);
				// Don't fail the check-in if notifications fail
			}

			// Award XP with enhanced error handling
			try {
				this.logger.debug(`[${operationId}] Awarding XP for check-in to user: ${createCheckInDto.owner.uid}`);
				await this.rewardsService.awardXP(
					{
						owner: createCheckInDto.owner.uid,
						amount: XP_VALUES.CHECK_IN_CLIENT,
						action: XP_VALUES_TYPES.CHECK_IN_CLIENT,
						source: {
							id: String(createCheckInDto.owner.uid),
							type: XP_VALUES_TYPES.CHECK_IN_CLIENT,
							details: 'Check-in reward',
						},
					},
					orgId,
					branchId,
				);
				this.logger.debug(
					`[${operationId}] XP awarded successfully for check-in to user: ${createCheckInDto.owner.uid}`,
				);
			} catch (xpError) {
				this.logger.error(
					`[${operationId}] Failed to award XP for check-in to user: ${createCheckInDto.owner.uid}`,
					xpError.stack,
				);
				// Don't fail the check-in if XP award fails
			}

			this.logger.log(`[${operationId}] Check-in successful for user: ${createCheckInDto.owner.uid}`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Check-in recorded successfully',
			};
		} catch (error) {
			this.logger.error(`[${operationId}] Check-in failed for user: ${createCheckInDto.owner?.uid}`, error.stack);
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
		orgId?: number,
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
				[Number(userId)],
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
	private async getOrganizationAdmins(orgId: number): Promise<any[]> {
		try {
			const adminUsers = await this.userRepository.find({
				where: {
					organisation: { uid: orgId },
					accessLevel: AccessLevel.ADMIN,
				},
				select: ['uid', 'email'],
			});
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
		orgId?: number,
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
							checkInId: checkIn.uid,
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
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; duration?: string }> {
		const operationId = `checkout_${Date.now()}`;
		this.logger.log(
			`[${operationId}] Check-out attempt for user: ${createCheckOutDto.owner?.uid}, orgId: ${orgId}, branchId: ${branchId}`,
		);

		try {
			// Enhanced validation
			this.logger.debug(`[${operationId}] Validating check-out data`);
			if (!createCheckOutDto?.owner) {
				this.logger.error(`[${operationId}] Owner information is required for check-out`);
				throw new BadRequestException(process.env.NOT_FOUND_MESSAGE);
			}

			if (!createCheckOutDto?.branch) {
				this.logger.error(`[${operationId}] Branch information is required for check-out`);
				throw new BadRequestException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.debug(`[${operationId}] Finding active check-in for user: ${createCheckOutDto.owner.uid}`);
			const checkIn = await this.checkInRepository.findOne({
				where: {
					owner: {
						uid: createCheckOutDto.owner.uid,
					},
				},
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch'],
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] No active check-in found for user: ${createCheckOutDto.owner.uid}`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			if (checkIn.checkOutTime) {
				this.logger.warn(`[${operationId}] User ${createCheckOutDto.owner.uid} has already checked out`);
				throw new BadRequestException('User has already checked out');
			}

			this.logger.debug(`[${operationId}] Found active check-in with ID: ${checkIn.uid}, calculating duration`);

			const checkOutTime = new Date(createCheckOutDto.checkOutTime);
			const checkInTime = new Date(checkIn.checkInTime);

			const minutesWorked = differenceInMinutes(checkOutTime, checkInTime);
			const hoursWorked = differenceInHours(checkOutTime, checkInTime);
			const remainingMinutes = minutesWorked % 60;

			const duration = `${hoursWorked}h ${remainingMinutes}m`;
			this.logger.debug(
				`[${operationId}] Calculated work duration: ${duration} (${minutesWorked} minutes total)`,
			);

			// Reverse geocode the check-in location to get full address
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
							this.logger.debug(`[${operationId}] Successfully geocoded address: ${geocodingResult.formattedAddress}`);
						}
					}
				}
			} catch (geocodingError) {
				this.logger.warn(
					`[${operationId}] Failed to reverse geocode check-in location: ${geocodingError.message}`,
				);
				// Don't fail the check-out if geocoding fails
			}

			// Update check-in record with check-out data
			this.logger.debug(`[${operationId}] Updating check-in record with check-out data`);
			await this.checkInRepository.update(checkIn.uid, {
				checkOutTime: createCheckOutDto?.checkOutTime,
				checkOutPhoto: createCheckOutDto?.checkOutPhoto,
				checkOutLocation: createCheckOutDto?.checkOutLocation,
				duration: duration,
				fullAddress: fullAddress,
			});

			// Send check-out notifications
			try {
				this.logger.debug(`[${operationId}] Sending check-out notifications`);
				const userName = checkIn.owner?.name || 'Staff member';
				await this.sendCheckOutNotifications(
					createCheckOutDto.owner.uid, 
					checkIn, 
					duration, 
					userName,
					fullAddress,
					orgId, 
					branchId
				);
				this.logger.debug(`[${operationId}] Check-out notifications sent successfully`);
			} catch (notificationError) {
				this.logger.warn(
					`[${operationId}] Failed to send check-out notifications: ${notificationError.message}`,
				);
				// Don't fail the check-out if notifications fail
			}

			// Award XP with enhanced error handling
			try {
				this.logger.debug(`[${operationId}] Awarding XP for check-out to user: ${createCheckOutDto.owner.uid}`);
				await this.rewardsService.awardXP(
					{
						owner: createCheckOutDto.owner.uid,
						amount: 10,
						action: 'CHECK_OUT',
						source: {
							id: createCheckOutDto.owner.toString(),
							type: 'check-in',
							details: 'Check-out reward',
						},
					},
					orgId,
					branchId,
				);
				this.logger.debug(
					`[${operationId}] XP awarded successfully for check-out to user: ${createCheckOutDto.owner.uid}`,
				);
			} catch (xpError) {
				this.logger.error(
					`[${operationId}] Failed to award XP for check-out to user: ${createCheckOutDto.owner.uid}`,
					xpError.stack,
				);
				// Don't fail the check-out if XP award fails
			}

			this.logger.log(
				`[${operationId}] Check-out successful for user: ${createCheckOutDto.owner.uid}, duration: ${duration}`,
			);

			return {
				message: process.env.SUCCESS_MESSAGE,
				duration: duration,
			};
		} catch (error) {
			this.logger.error(
				`[${operationId}] Check-out failed for user: ${createCheckOutDto.owner?.uid}`,
				error.stack,
			);
			return {
				message: error?.message,
				duration: null,
			};
		}
	}

	async checkInStatus(reference: number): Promise<any> {
		try {
			const [checkIn] = await this.checkInRepository.find({
				where: {
					owner: {
						uid: reference,
					},
				},
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
				whereCondition.organization = { uid: organizationUid };
			}

			const checkIns = await this.checkInRepository.find({
				where: whereCondition,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch', 'organization'],
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

	async getUserCheckIns(userUid: number, organizationUid?: string): Promise<any> {
		try {
			const whereCondition: any = {
				owner: { uid: userUid },
			};

			if (organizationUid) {
				whereCondition.organization = { uid: organizationUid };
			}

			const checkIns = await this.checkInRepository.find({
				where: whereCondition,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch'],
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
}
