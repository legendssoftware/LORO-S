import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../user/entities/user.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { AccessLevel } from '../lib/enums/user.enums';
import { NotificationResponse } from '../lib/types/notification';
import { formatDistanceToNow } from 'date-fns';
import { NotificationStatus } from '../lib/enums/notification.enums';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES } from '../lib/constants/constants';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { ExpoPushService, ExpoPushMessage } from '../lib/services/expo-push.service';

@Injectable()
export class NotificationsService {
	private readonly logger = new Logger(NotificationsService.name);

	constructor(
		@InjectRepository(Notification)
		private readonly notificationRepository: Repository<Notification>,
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		@InjectRepository(ClientAuth)
		private readonly clientAuthRepository: Repository<ClientAuth>,
		private readonly rewardsService: RewardsService,
		private readonly expoPushService: ExpoPushService,
	) {}

	async create(createNotificationDto: CreateNotificationDto): Promise<{ message: string }> {
		try {
			const notification = await this.notificationRepository.save(createNotificationDto);

			if (!notification) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async findAll(): Promise<{ message: string; notifications: Notification[] | null }> {
		try {
			const notifications = await this.notificationRepository.find();

			if (!notifications) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				notifications: notifications,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				notifications: null,
			};

			return response;
		}
	}

	async findOne(ref: number): Promise<{ message: string; notification: Notification | null }> {
		try {
			const notification = await this.notificationRepository.findOne({
				where: { uid: ref },
				relations: ['owner'],
			});

			if (!notification) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				notification: notification,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				notification: null,
			};

			return response;
		}
	}

	async findForUser(ref: number): Promise<{ message: string; notification: NotificationResponse[] | null }> {
		try {
			const notifications = await this.notificationRepository.find({
				where: {
					owner: {
						uid: ref,
					},
					status: Not(NotificationStatus.ARCHIVED),
				},
			});

			if (!notifications.length) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				notification: notifications.map((notification) => ({
					...notification,
					createdAt: `${notification.createdAt}`,
					updatedAt: `${notification.updatedAt}`,
					recordAge: formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true }),
					updateAge: formatDistanceToNow(new Date(notification.updatedAt), { addSuffix: true }),
				})),
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				notification: null,
			};

			return response;
		}
	}

	async update(ref: number, updateNotificationDto: UpdateNotificationDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			const notification = await this.notificationRepository.update(ref, updateNotificationDto);

			if (!notification) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			await this.rewardsService.awardXP({
				owner: updateNotificationDto.owner.uid,
				amount: XP_VALUES.NOTIFICATION,
				action: XP_VALUES_TYPES.NOTIFICATION,
				source: {
					id: updateNotificationDto.owner.uid.toString(),
					type: XP_VALUES_TYPES.NOTIFICATION,
					details: 'Notification reward',
				},
			}, orgId, branchId);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async remove(ref: number): Promise<{ message: string }> {
		try {
			const notification = await this.notificationRepository.delete(ref);

			if (!notification) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	/**
	 * Ensure push token uniqueness - one token per user
	 * Clears token from other users before assigning to current user
	 * This prevents notifications from being sent to the wrong user when multiple users share a device
	 */
	private async ensureTokenUniqueness(
		userId: number, 
		token: string
	): Promise<{ conflictingUsers: number; clearedUsers: User[] }> {
		try {
			// Find all users (except current user) who have this same token
			const usersWithToken = await this.userRepository.find({
				where: { 
					expoPushToken: token,
					uid: Not(userId) 
				},
				select: ['uid', 'email', 'name', 'surname', 'expoPushToken']
			});

			if (usersWithToken.length > 0) {
				console.warn(`🔴 [NotificationService] [TokenConflict] Detected ${usersWithToken.length} users with duplicate token`, {
					currentUserId: userId,
					conflictingUserIds: usersWithToken.map(u => u.uid),
				});

				// Clear the token from all conflicting users
				// This is necessary because a device can only be logged into one account at a time
				await this.userRepository.update(
					{ expoPushToken: token, uid: Not(userId) },
					{ 
						expoPushToken: null, 
						deviceId: null, 
						platform: null, 
						pushTokenUpdatedAt: null 
					}
				);


				return { 
					conflictingUsers: usersWithToken.length, 
					clearedUsers: usersWithToken 
				};
			}


			return { conflictingUsers: 0, clearedUsers: [] };
		} catch (error) {
			// Don't throw - allow registration to proceed even if uniqueness check fails
			return { conflictingUsers: 0, clearedUsers: [] };
		}
	}

	async registerPushToken(userId: number, registerTokenDto: RegisterPushTokenDto, role?: string): Promise<{ message: string }> {
		try {
			const isClient = role === AccessLevel.CLIENT || role?.toLowerCase() === 'client';
			
			// Validate token format
			const isValidToken = this.expoPushService.isValidExpoPushToken(registerTokenDto.token);

			if (!isValidToken) {
				this.logger.warn('⚠️ [NotificationService] Invalid token format detected');
			}

			// Handle clients differently
			if (isClient) {
				const existingClientAuth = await this.clientAuthRepository.findOne({ 
					where: { uid: userId },
					relations: ['client']
				});
				
				if (!existingClientAuth) {
					this.logger.error('❌ [NotificationService] Client auth not found', { userId });
					throw new NotFoundException('Client not found');
				}

				// Check if this is a duplicate registration
				const isSameToken = existingClientAuth.expoPushToken === registerTokenDto.token;
				const isSameDevice = existingClientAuth.deviceId === registerTokenDto.deviceId;
				const isSamePlatform = existingClientAuth.platform === registerTokenDto.platform;
				const isRecent = existingClientAuth.pushTokenUpdatedAt && 
								 (Date.now() - new Date(existingClientAuth.pushTokenUpdatedAt).getTime()) < 10000; // 10 seconds

				if (isSameToken && isSameDevice && isSamePlatform && isRecent) {
					return { message: 'Push token already registered (duplicate request)' };
				}

				// Check for duplicate tokens across client auths
				const conflictingClientAuths = await this.clientAuthRepository.find({
					where: {
						expoPushToken: registerTokenDto.token,
						uid: Not(userId),
					},
				});

				if (conflictingClientAuths.length > 0) {
					console.log(`🔧 [NotificationService] Token conflict resolved - clearing token from ${conflictingClientAuths.length} other client auth(s)`, {
						clearedClientAuthIds: conflictingClientAuths.map(ca => ca.uid),
					});
					
					// Clear tokens from conflicting client auths
					await this.clientAuthRepository.update(
						{ uid: In(conflictingClientAuths.map(ca => ca.uid)) },
						{
							expoPushToken: null,
							deviceId: null,
							platform: null,
							pushTokenUpdatedAt: null,
						}
					);
				}

				console.log('💾 [NotificationService] Updating client auth with new token...');
				const updateResult = await this.clientAuthRepository.update(userId, {
					expoPushToken: registerTokenDto.token,
					deviceId: registerTokenDto.deviceId,
					platform: registerTokenDto.platform,
					pushTokenUpdatedAt: new Date(),
				});

				console.log('✅ [NotificationService] Client auth update result:', {
					affected: updateResult.affected,
					raw: updateResult.raw,
				});

				// Verify the update was successful
				const updatedClientAuth = await this.clientAuthRepository.findOne({ where: { uid: userId } });
				console.log('🔍 [NotificationService] Post-update verification:', {
					userId,
					newDeviceId: updatedClientAuth?.deviceId,
					newPlatform: updatedClientAuth?.platform,
					newTimestamp: updatedClientAuth?.pushTokenUpdatedAt,
				});

				console.log('✅ [NotificationService] Push token registered successfully for client', { userId });
				return { message: 'Push token registered successfully' };
			}

			// Original user handling code
			// Check if user exists first
			const existingUser = await this.userRepository.findOne({ where: { uid: userId } });
			if (!existingUser) {
				console.error('❌ [NotificationService] User not found', { userId });
				throw new NotFoundException('User not found');
			}

			// Check if this is a duplicate registration
			const isSameToken = existingUser.expoPushToken === registerTokenDto.token;
			const isSameDevice = existingUser.deviceId === registerTokenDto.deviceId;
			const isSamePlatform = existingUser.platform === registerTokenDto.platform;
			const isRecent = existingUser.pushTokenUpdatedAt && 
							 (Date.now() - new Date(existingUser.pushTokenUpdatedAt).getTime()) < 10000; // 10 seconds

			if (isSameToken && isSameDevice && isSamePlatform && isRecent) {
				console.log('⏭️ [NotificationService] Duplicate registration detected - same token, device, and platform updated recently', {
					userId,
					timeSinceLastUpdate: existingUser.pushTokenUpdatedAt ? 
						Date.now() - new Date(existingUser.pushTokenUpdatedAt).getTime() : 'N/A'
				});
				return { message: 'Push token already registered (duplicate request)' };
			}

			// CRITICAL FIX: Ensure token uniqueness before assignment
			// This prevents notifications from being sent to wrong users when devices are shared
			console.log('🔍 [NotificationService] Checking for duplicate tokens across users...');
			const uniquenessCheck = await this.ensureTokenUniqueness(userId, registerTokenDto.token);
			
			if (uniquenessCheck.conflictingUsers > 0) {
				console.log(`🔧 [NotificationService] Token conflict resolved - cleared token from ${uniquenessCheck.conflictingUsers} other user(s)`, {
					clearedUserIds: uniquenessCheck.clearedUsers.map(u => u.uid),
				});
			}

			console.log('💾 [NotificationService] Updating user with new token...');
			const updateResult = await this.userRepository.update(userId, {
				expoPushToken: registerTokenDto.token,
				deviceId: registerTokenDto.deviceId,
				platform: registerTokenDto.platform,
				pushTokenUpdatedAt: new Date(),
			});

			console.log('✅ [NotificationService] User update result:', {
				affected: updateResult.affected,
				raw: updateResult.raw,
			});

			// Verify the update was successful
			const updatedUser = await this.userRepository.findOne({ where: { uid: userId } });

			return { message: 'Push token registered successfully' };
		} catch (error) {
			console.error('❌ [NotificationService] Failed to register push token:', {
				userId,
				error: error instanceof Error ? error.message : 'Unknown error',
				errorName: error instanceof Error ? error.name : 'Unknown',
			});
			throw new BadRequestException(`Failed to register push token: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Verify and sync push token status
	 */
	async verifyPushToken(userId: number, registerTokenDto: RegisterPushTokenDto, role?: string): Promise<{
		isValid: boolean;
		needsUpdate: boolean;
		message: string;
		serverToken: string | null;
		lastUpdated: string | null;
	}> {
		try {
			const isClient = role === AccessLevel.CLIENT || role?.toLowerCase() === 'client';
			
			console.log('🔍 [NotificationService] Starting token verification', {
				userId,
				role: role || 'user',
				isClient,
				deviceId: registerTokenDto.deviceId,
				platform: registerTokenDto.platform,
				timestamp: new Date().toISOString(),
			});

			// Handle clients differently
			if (isClient) {
				const clientAuth = await this.clientAuthRepository.findOne({ where: { uid: userId } });
				
				if (!clientAuth) {
					console.error('❌ [NotificationService] Client auth not found during verification', { userId });
					throw new NotFoundException('Client not found');
				}

				const serverToken = clientAuth.expoPushToken;
				const deviceToken = registerTokenDto.token;
				const lastUpdated = clientAuth.pushTokenUpdatedAt ? clientAuth.pushTokenUpdatedAt.toISOString() : null;

				console.log('📊 [NotificationService] Client auth token comparison data:', {
					userId,
					serverTokenLength: serverToken?.length || 0,
					deviceTokenLength: deviceToken?.length || 0,
					lastUpdated,
					deviceId: clientAuth.deviceId,
					platform: clientAuth.platform,
				});

				// Check if tokens match
				const tokensMatch = serverToken === deviceToken;
				console.log('🔍 [NotificationService] Token match analysis:', {
					tokensMatch,
					serverTokenExists: !!serverToken,
					deviceTokenExists: !!deviceToken,
				});
				
				// Check if server token is valid format
				const serverTokenValid = serverToken ? this.expoPushService.isValidExpoPushToken(serverToken) : false;
				console.log('🔍 [NotificationService] Server token validation:', {
					serverTokenValid,
					serverTokenFormat: serverToken ? 'ExponentPushToken format' : 'null',
				});
				
				// Check if device token is valid format
				const deviceTokenValid = this.expoPushService.isValidExpoPushToken(deviceToken);
				console.log('🔍 [NotificationService] Device token validation:', {
					deviceTokenValid,
					deviceTokenFormat: deviceToken ? 'ExponentPushToken format' : 'null',
				});

				// Determine if update is needed
				const needsUpdate = !tokensMatch || !serverTokenValid || !serverToken;
				console.log('📊 [NotificationService] Update decision logic:', {
					needsUpdate,
					reason: !tokensMatch ? 'Tokens do not match' : !serverTokenValid ? 'Server token invalid format' : 'No server token',
				});

				return {
					isValid: tokensMatch && serverTokenValid && !!serverToken,
					needsUpdate,
					message: needsUpdate 
						? 'Token needs to be updated on server' 
						: 'Token is valid and up to date',
					serverToken,
					lastUpdated,
				};
			}

			// Original user handling code
			const user = await this.userRepository.findOne({ where: { uid: userId } });
			
			if (!user) {
				console.error('❌ [NotificationService] User not found during verification', { userId });
				throw new NotFoundException('User not found');
			}

			const serverToken = user.expoPushToken;
			const deviceToken = registerTokenDto.token;
			const lastUpdated = user.pushTokenUpdatedAt ? user.pushTokenUpdatedAt.toISOString() : null;

			console.log('📊 [NotificationService] Token comparison data:', {
				userId,
				serverTokenLength: serverToken?.length || 0,
				deviceTokenLength: deviceToken?.length || 0,
				lastUpdated,
				deviceId: user.deviceId,
				platform: user.platform,
			});

			// Check if tokens match
			const tokensMatch = serverToken === deviceToken;
			console.log('🔍 [NotificationService] Token match analysis:', {
				tokensMatch,
				serverTokenExists: !!serverToken,
				deviceTokenExists: !!deviceToken,
			});
			
			// Check if server token is valid format
			const serverTokenValid = serverToken ? this.expoPushService.isValidExpoPushToken(serverToken) : false;
			console.log('🔍 [NotificationService] Server token validation:', {
				serverTokenValid,
				serverTokenFormat: serverToken ? 'ExponentPushToken format' : 'null',
			});
			
			// Check if device token is valid format
			const deviceTokenValid = this.expoPushService.isValidExpoPushToken(deviceToken);
			console.log('🔍 [NotificationService] Device token validation:', {
				deviceTokenValid,
				deviceTokenFormat: deviceToken ? 'ExponentPushToken format' : 'null',
			});

			// Determine if update is needed
			const needsUpdate = !tokensMatch || !serverTokenValid || !serverToken;
			console.log('📊 [NotificationService] Update decision logic:', {
				needsUpdate,
				reasons: {
					tokensDoNotMatch: !tokensMatch,
					serverTokenInvalid: !serverTokenValid,
					noServerToken: !serverToken,
				},
			});

			// Auto-update if needed and device token is valid
			if (needsUpdate && deviceTokenValid) {
				console.log('🔄 [NotificationService] Auto-updating token...');
				
				const updateResult = await this.userRepository.update(userId, {
					expoPushToken: deviceToken,
					deviceId: registerTokenDto.deviceId,
					platform: registerTokenDto.platform,
					pushTokenUpdatedAt: new Date(),
				});

				console.log('✅ [NotificationService] Auto-update completed:', {
					affected: updateResult.affected,
					newTimestamp: new Date().toISOString(),
				});

				const response = {
					isValid: true,
					needsUpdate: true,
					message: 'Token updated successfully',
					serverToken: deviceToken,
					lastUpdated: new Date().toISOString(),
				};

				return response;
			}

			// Return current status
			const response = {
				isValid: serverTokenValid && tokensMatch,
				needsUpdate: false,
				message: tokensMatch && serverTokenValid 
					? 'Token is valid and up to date' 
					: serverTokenValid 
						? 'Token mismatch detected' 
						: 'Invalid token format',
				serverToken,
				lastUpdated,
			};

			return response;
		} catch (error) {
			console.error('❌ [NotificationService] Token verification failed:', {
				userId,
				error: error instanceof Error ? error.message : 'Unknown error',
				errorName: error instanceof Error ? error.name : 'Unknown',
			});
			throw new BadRequestException(`Failed to verify push token: ${error.message}`);
		}
	}

	/**
	 * Send push notification for task assignment
	 */
	async sendTaskAssignmentNotification(
		userIds: number[],
		taskTitle: string,
		taskId: number,
		assignedBy: string,
	): Promise<void> {
		try {
			const users = await this.userRepository.find({ where: { uid: In(userIds) } });
			const messages: ExpoPushMessage[] = [];

			for (const user of users) {
				if (user.expoPushToken && this.expoPushService.isValidExpoPushToken(user.expoPushToken)) {
					const message = this.expoPushService.createTaskAssignmentNotification(
						user.expoPushToken,
						taskTitle,
						taskId,
						assignedBy,
					);

					messages.push(message);
				}
			}


			if (messages.length > 0) {
				await this.expoPushService.sendPushNotifications(messages);
			}
		} catch (error) {
			console.error('Failed to send task assignment notifications:', error);
		}
	}

	/**
	 * Send push notification for lead assignment
	 */
	async sendLeadAssignmentNotification(
		userIds: number[],
		leadName: string,
		leadId: number,
		assignedBy: string,
	): Promise<void> {
		try {
			const users = await this.userRepository.findByIds(userIds);
			const messages: ExpoPushMessage[] = [];

			for (const user of users) {
				if (user.expoPushToken && this.expoPushService.isValidExpoPushToken(user.expoPushToken)) {
					const message = this.expoPushService.createLeadAssignmentNotification(
						user.expoPushToken,
						leadName,
						leadId,
						assignedBy,
					);
					messages.push(message);
				}
			}

			if (messages.length > 0) {
				await this.expoPushService.sendPushNotifications(messages);
			}
		} catch (error) {
			console.error('Failed to send lead assignment notifications:', error);
		}
	}

	/**
	 * Send push notification for task reminders
	 */
	async sendTaskReminderNotification(
		userId: number,
		taskTitle: string,
		taskId: number,
		timeLeft: string,
	): Promise<void> {
		try {
			const user = await this.userRepository.findOne({ where: { uid: userId } });

			if (user?.expoPushToken && this.expoPushService.isValidExpoPushToken(user.expoPushToken)) {
				const message = this.expoPushService.createTaskReminderNotification(
					user.expoPushToken,
					taskTitle,
					taskId,
					timeLeft,
				);
				await this.expoPushService.sendSingleNotification(message);
			}
		} catch (error) {
			console.error('Failed to send task reminder notification:', error);
		}
	}

	/**
	 * Send overdue task summary notifications
	 */
	async sendOverdueTaskNotifications(
		userId: number,
		taskCount: number,
		overdueCount: number,
		missedCount: number,
	): Promise<void> {
		try {
			const user = await this.userRepository.findOne({ where: { uid: userId } });

			if (user?.expoPushToken && this.expoPushService.isValidExpoPushToken(user.expoPushToken)) {
				const message = this.expoPushService.createOverdueTaskNotification(
					user.expoPushToken,
					taskCount,
					overdueCount,
					missedCount,
				);
				await this.expoPushService.sendSingleNotification(message);
			}
		} catch (error) {
			console.error('Failed to send overdue task notification:', error);
		}
	}

	/**
	 * Send push notification for task completion
	 */
	async sendTaskCompletionNotification(
		userIds: number[],
		taskTitle: string,
		taskId: number,
		completedBy: string,
	): Promise<void> {
		try {
			const users = await this.userRepository.findByIds(userIds);
			const messages: ExpoPushMessage[] = [];

			for (const user of users) {
				if (user.expoPushToken && this.expoPushService.isValidExpoPushToken(user.expoPushToken)) {
					const message = this.expoPushService.createTaskCompletionNotification(
						user.expoPushToken,
						taskTitle,
						taskId,
						completedBy,
					);
					messages.push(message);
				}
			}

			if (messages.length > 0) {
				await this.expoPushService.sendPushNotifications(messages);
			}
		} catch (error) {
			console.error('Failed to send task completion notifications:', error);
		}
	}
}
