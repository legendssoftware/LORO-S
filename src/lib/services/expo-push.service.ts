import { Injectable, Logger } from '@nestjs/common';
import fetch from 'node-fetch';

export interface ExpoPushMessage {
	to: string;
	title: string;
	body: string;
	data?: Record<string, any>;
	sound?: string | boolean;
	badge?: number;
	priority?: 'default' | 'normal' | 'high';
	channelId?: string;
}

export interface ExpoPushTicket {
	status: 'ok' | 'error';
	id?: string;
	message?: string;
	details?: any;
}

export interface ExpoPushReceipt {
	status: 'ok' | 'error';
	message?: string;
	details?: any;
}

@Injectable()
export class ExpoPushService {
	private readonly logger = new Logger(ExpoPushService.name);
	private readonly EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
	private readonly EXPO_RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';
	private readonly MAX_BATCH_SIZE = 100; // Expo's recommended batch size

	async sendPushNotifications(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
		try {
			// Handle batch size limitations
			if (messages.length > this.MAX_BATCH_SIZE) {
				this.logger.warn(`📦 Large batch detected (${messages.length} messages). Processing in chunks...`);
				return this.sendInBatches(messages);
			}

			const response = await fetch(this.EXPO_PUSH_URL, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Accept-encoding': 'gzip, deflate',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(messages),
			});

			if (!response.ok) {
				let errorDetails = '';
				try {
					const errorBody = await response.text();
					errorDetails = errorBody ? ` - Response: ${errorBody}` : '';
				} catch (parseError) {
					// If we can't parse the error response, just continue with status
				}
				
				const errorMessage = `HTTP ${response.status} ${response.statusText}${errorDetails}`;
				this.logger.error(`❌ Expo Push API error: ${errorMessage}`, {
					status: response.status,
					statusText: response.statusText,
					url: response.url,
					messageCount: messages.length,
					tokens: messages.map(m => m.to.substring(0, 30) + '...'),
				});
				throw new Error(errorMessage);
			}

			const result = await response.json();
			this.logger.log(`✅ Sent ${messages.length} push notification(s) to Expo`);

			// Log any errors from the response with detailed information
			if (result.data) {
				const errors = result.data.filter((ticket: ExpoPushTicket) => ticket.status === 'error');
				if (errors.length > 0) {
					this.logger.error(`❌ ${errors.length}/${messages.length} push notifications failed:`, {
						errors: errors.map((error, index) => ({
							index,
							token: messages[index]?.to?.substring(0, 30) + '...',
							message: error.message || 'Unknown error',
							details: error.details || 'No additional details'
						}))
					});
				}
			}

			return result.data || [];
		} catch (error) {
			this.logger.error('❌ Failed to send push notifications:', {
				error: error.message,
				messageCount: messages.length,
				tokens: messages.map(m => m.to.substring(0, 30) + '...'),
				stack: error.stack
			});
			throw error;
		}
	}

	/**
	 * Send notifications in batches to respect Expo's limits
	 */
	private async sendInBatches(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
		const batches = this.chunkArray(messages, this.MAX_BATCH_SIZE);
		const allTickets: ExpoPushTicket[] = [];

		for (let i = 0; i < batches.length; i++) {
			this.logger.log(`📦 Sending batch ${i + 1}/${batches.length} (${batches[i].length} messages)`);
			
			const batchTickets = await this.sendSingleBatch(batches[i]);
			allTickets.push(...batchTickets);

			// Add small delay between batches to avoid rate limiting
			if (i < batches.length - 1) {
				await this.delay(100);
			}
		}

		return allTickets;
	}

	/**
	 * Send a single batch of messages
	 */
	private async sendSingleBatch(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
		const response = await fetch(this.EXPO_PUSH_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Accept-encoding': 'gzip, deflate',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(messages),
		});

		if (!response.ok) {
			let errorDetails = '';
			try {
				const errorBody = await response.text();
				errorDetails = errorBody ? ` - Response: ${errorBody}` : '';
			} catch (parseError) {
				// If we can't parse the error response, just continue with status
			}
			
			const errorMessage = `HTTP ${response.status} ${response.statusText}${errorDetails}`;
			this.logger.error(`❌ Expo Push API batch error: ${errorMessage}`, {
				status: response.status,
				batchSize: messages.length,
				tokens: messages.map(m => m.to.substring(0, 30) + '...'),
			});
			throw new Error(errorMessage);
		}

		const result = await response.json();
		return result.data || [];
	}

	/**
	 * Check delivery receipts for sent notifications
	 */
	async checkPushReceipts(ticketIds: string[]): Promise<Map<string, ExpoPushReceipt>> {
		try {
			// Handle batch size limitations for receipts too
			if (ticketIds.length > this.MAX_BATCH_SIZE) {
				return this.checkReceiptsInBatches(ticketIds);
			}

			const response = await fetch(this.EXPO_RECEIPT_URL, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Accept-encoding': 'gzip, deflate',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ ids: ticketIds }),
			});

			if (!response.ok) {
				let errorDetails = '';
				try {
					const errorBody = await response.text();
					errorDetails = errorBody ? ` - Response: ${errorBody}` : '';
				} catch (parseError) {
					// If we can't parse the error response, just continue with status
				}
				
				const errorMessage = `HTTP ${response.status} ${response.statusText}${errorDetails}`;
				this.logger.error(`❌ Expo Receipt API error: ${errorMessage}`, {
					status: response.status,
					statusText: response.statusText,
					ticketCount: ticketIds.length,
					ticketIds: ticketIds.slice(0, 5), // Show first 5 ticket IDs for debugging
				});
				throw new Error(errorMessage);
			}

			const result = await response.json();
			
			// Log receipt summary with detailed error information
			const receipts = result.data || {};
			const successCount = Object.values(receipts).filter((r: any) => r.status === 'ok').length;
			const errorCount = Object.values(receipts).filter((r: any) => r.status === 'error').length;
			
			this.logger.log(`📨 Receipt check: ${successCount} delivered, ${errorCount} failed out of ${ticketIds.length} tickets`);
			
			if (errorCount > 0) {
				const failedReceipts = Object.entries(receipts)
					.filter(([_, receipt]: [string, any]) => receipt.status === 'error')
					.slice(0, 5); // Show first 5 errors
				
				// Filter out BadDeviceToken errors from detailed logging (they're handled by cleanup)
				const nonTokenErrors = failedReceipts.filter(([_, receipt]: [string, any]) => {
					const message = receipt.message || '';
					return !message.includes('BadDeviceToken') && !message.includes('InvalidCredentials');
				});
				
				if (nonTokenErrors.length > 0) {
					this.logger.warn(`❌ Failed receipt details:`, {
						errors: nonTokenErrors.map(([ticketId, receipt]: [string, any]) => ({
							ticketId,
							message: receipt.message || 'Unknown error',
							details: receipt.details || 'No additional details'
						}))
					});
				}
				
				// Log BadDeviceToken errors at debug level (cleanup handles them)
				const tokenErrors = failedReceipts.filter(([_, receipt]: [string, any]) => {
					const message = receipt.message || '';
					return message.includes('BadDeviceToken') || message.includes('InvalidCredentials');
				});
				
				if (tokenErrors.length > 0) {
					this.logger.debug(`📱 ${tokenErrors.length} invalid device token(s) detected - will be cleaned up automatically`);
				}
			}
			
			return new Map(Object.entries(receipts));
		} catch (error) {
			this.logger.error('❌ Failed to check push receipts:', {
				error: error.message,
				ticketCount: ticketIds.length,
				ticketIds: ticketIds.slice(0, 5),
				stack: error.stack
			});
			throw error;
		}
	}

	/**
	 * Check receipts in batches
	 */
	private async checkReceiptsInBatches(ticketIds: string[]): Promise<Map<string, ExpoPushReceipt>> {
		const batches = this.chunkArray(ticketIds, this.MAX_BATCH_SIZE);
		const allReceipts = new Map<string, ExpoPushReceipt>();

		for (const batch of batches) {
			const batchReceipts = await this.checkSingleReceiptBatch(batch);
			batchReceipts.forEach((receipt, id) => allReceipts.set(id, receipt));
		}

		return allReceipts;
	}

	/**
	 * Check receipts for a single batch
	 */
	private async checkSingleReceiptBatch(ticketIds: string[]): Promise<Map<string, ExpoPushReceipt>> {
		const response = await fetch(this.EXPO_RECEIPT_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Accept-encoding': 'gzip, deflate',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ ids: ticketIds }),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const result = await response.json();
		return new Map(Object.entries(result.data || {}));
	}

	async sendSingleNotification(message: ExpoPushMessage): Promise<ExpoPushTicket> {
		const tickets = await this.sendPushNotifications([message]);
		return tickets[0];
	}

	/**
	 * Utility function to chunk arrays
	 */
	private chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	/**
	 * Utility function for delays
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Create task assignment notification with emoji
	 */
	createTaskAssignmentNotification(
		pushToken: string,
		taskTitle: string,
		taskId: number,
		assignedBy: string,
	): ExpoPushMessage {
		console.log('pushToken', pushToken, 'sending task assignment notification');

		return {
			to: pushToken,
			title: '📋 New Task Assigned',
			body: `${taskTitle} - Assigned by ${assignedBy}`,
			data: {
				type: 'task_assigned',
				taskId: taskId,
				screen: '/sales/tasks',
				action: 'view_task',
			},
			sound: 'default',
			badge: 1,
			priority: 'high',
			channelId: 'tasks',
		};
	}

	/**
	 * Create task reminder notification with emoji
	 */
	createTaskReminderNotification(
		pushToken: string,
		taskTitle: string,
		taskId: number,
		timeLeft: string,
	): ExpoPushMessage {
		return {
			to: pushToken,
			title: '⏰ Task Deadline Approaching',
			body: `"${taskTitle}" is due ${timeLeft}`,
			data: {
				type: 'task_reminder',
				taskId: taskId,
				screen: '/sales/tasks',
				action: 'view_task',
			},
			sound: 'default',
			badge: 1,
			priority: 'high',
			channelId: 'tasks',
		};
	}

	/**
	 * Create lead assignment notification with emoji
	 */
	createLeadAssignmentNotification(
		pushToken: string,
		leadName: string,
		leadId: number,
		assignedBy: string,
	): ExpoPushMessage {
		return {
			to: pushToken,
			title: '💰 New Lead Assigned',
			body: `${leadName} - New sales opportunity assigned by ${assignedBy}`,
			data: {
				type: 'lead_assigned',
				leadId: leadId,
				screen: '/sales/leads',
				action: 'view_lead',
			},
			sound: 'default',
			badge: 1,
			priority: 'high',
			channelId: 'sales',
		};
	}

	/**
	 * Create task completion notification with emoji
	 */
	createTaskCompletionNotification(
		pushToken: string,
		taskTitle: string,
		taskId: number,
		completedBy: string,
	): ExpoPushMessage {
		return {
			to: pushToken,
			title: '✅ Task Completed',
			body: `"${taskTitle}" has been completed by ${completedBy}`,
			data: {
				type: 'task_completed',
				taskId: taskId,
				screen: '/sales/tasks',
				action: 'view_task',
			},
			sound: 'default',
			badge: 1,
			priority: 'normal',
			channelId: 'tasks',
		};
	}

	/**
	 * Create overdue task notification with emoji
	 */
	createOverdueTaskNotification(
		pushToken: string,
		taskCount: number,
		overdueCount: number,
		missedCount: number,
	): ExpoPushMessage {
		return {
			to: pushToken,
			title: '🚨 Overdue & Missed Tasks',
			body: `You have ${taskCount} task(s) that need attention (${overdueCount} overdue, ${missedCount} missed)`,
			data: {
				type: 'tasks_overdue',
				screen: '/sales/tasks',
				action: 'view_overdue_tasks',
			},
			sound: 'default',
			badge: taskCount,
			priority: 'high',
			channelId: 'important',
		};
	}

	/**
	 * Validate if a token looks like a valid Expo push token
	 */
	isValidExpoPushToken(token: string): boolean {
		if (!token) {
			this.logger.debug('🔍 Token validation failed: Token is null or undefined');
			return false;
		}
		
		if (typeof token !== 'string') {
			this.logger.warn(`🔍 Token validation failed: Expected string, got ${typeof token}`, {
				tokenType: typeof token,
				tokenValue: String(token).substring(0, 50)
			});
			return false;
		}
		
		const isValid = token.startsWith('ExponentPushToken[') && token.endsWith(']');
		const expectedLength = 50; // Typical Expo token length
		
		if (!isValid) {
			this.logger.warn('🔍 Token validation failed: Invalid format', {
				tokenPrefix: token.substring(0, 20),
				startsCorrectly: token.startsWith('ExponentPushToken['),
				endsCorrectly: token.endsWith(']'),
				length: token.length,
				expectedFormat: 'ExponentPushToken[...]'
			});
		} else if (token.length < expectedLength - 10 || token.length > expectedLength + 20) {
			this.logger.warn('🔍 Token validation warning: Unusual token length', {
				tokenLength: token.length,
				expectedRange: `${expectedLength - 10}-${expectedLength + 20}`,
				tokenPrefix: token.substring(0, 30) + '...'
			});
		} else {
			this.logger.debug('✅ Token validation passed', {
				tokenPrefix: token.substring(0, 30) + '...',
				length: token.length
			});
		}
		
		return isValid;
	}

	/**
	 * Check if device needs registration based on user's stored token
	 */
	async checkDeviceRegistrationStatus(
		user: any,
		deviceToken: string,
		deviceId: string,
		platform: string
	): Promise<{
		needsRegistration: boolean;
		reason: string;
		serverToken: string | null;
		isValidFormat: boolean;
		tokensMatch?: boolean;
	}> {
		try {
			this.logger.debug('🔍 [ExpoPushService] Checking device registration status', {
				userId: user.uid,
				userEmail: user.email,
				deviceTokenPrefix: deviceToken ? deviceToken.substring(0, 30) + '...' : 'null',
				deviceId: deviceId || 'null',
				platform: platform || 'null',
				serverTokenPrefix: user.expoPushToken ? user.expoPushToken.substring(0, 30) + '...' : 'null',
				lastUpdated: user.pushTokenUpdatedAt ? user.pushTokenUpdatedAt.toISOString() : 'never'
			});
			
			const serverToken = user.expoPushToken;
			const isValidFormat = this.isValidExpoPushToken(deviceToken);
			const tokensMatch = serverToken === deviceToken;
			
			// Check if user has no token stored
			if (!serverToken) {
				this.logger.warn('🔴 [ExpoPushService] No token stored on server', {
					userId: user.uid,
					deviceTokenProvided: !!deviceToken
				});
				return {
					needsRegistration: true,
					reason: 'No token stored on server',
					serverToken: null,
					isValidFormat,
					tokensMatch: false,
				};
			}

			// Check if server token format is invalid
			if (!this.isValidExpoPushToken(serverToken)) {
				this.logger.error('🔴 [ExpoPushService] Server token has invalid format', {
					userId: user.uid,
					serverTokenPrefix: serverToken.substring(0, 30) + '...',
					serverTokenLength: serverToken.length
				});
				return {
					needsRegistration: true,
					reason: 'Server token has invalid format',
					serverToken,
					isValidFormat,
					tokensMatch,
				};
			}

			// Check if device token format is invalid
			if (!isValidFormat) {
				this.logger.warn('🔴 [ExpoPushService] Device token has invalid format', {
					userId: user.uid,
					deviceTokenPrefix: deviceToken.substring(0, 30) + '...',
					deviceTokenLength: deviceToken.length
				});
				return {
					needsRegistration: true,
					reason: 'Device token has invalid format',
					serverToken,
					isValidFormat,
					tokensMatch: false,
				};
			}

			// Check if tokens don't match
			if (!tokensMatch) {
				this.logger.warn('🔴 [ExpoPushService] Token mismatch detected', {
					userId: user.uid,
					serverTokenPrefix: serverToken.substring(0, 30) + '...',
					deviceTokenPrefix: deviceToken.substring(0, 30) + '...',
					serverTokenLength: serverToken.length,
					deviceTokenLength: deviceToken.length
				});
				return {
					needsRegistration: true,
					reason: 'Device token differs from server token',
					serverToken,
					isValidFormat,
					tokensMatch,
				};
			}

			// Check if device ID or platform changed
			if (user.deviceId && user.deviceId !== deviceId) {
				this.logger.warn('🔴 [ExpoPushService] Device ID changed', {
					userId: user.uid,
					oldDeviceId: user.deviceId,
					newDeviceId: deviceId
				});
				return {
					needsRegistration: true,
					reason: 'Device ID changed',
					serverToken,
					isValidFormat,
					tokensMatch,
				};
			}

			if (user.platform && user.platform !== platform) {
				this.logger.warn('🔴 [ExpoPushService] Platform changed', {
					userId: user.uid,
					oldPlatform: user.platform,
					newPlatform: platform
				});
				return {
					needsRegistration: true,
					reason: 'Platform changed',
					serverToken,
					isValidFormat,
					tokensMatch,
				};
			}

			// Check if token is very old (older than 30 days)
			if (user.pushTokenUpdatedAt) {
				const daysSinceUpdate = Math.floor(
					(Date.now() - new Date(user.pushTokenUpdatedAt).getTime()) / (1000 * 60 * 60 * 24)
				);
				
				if (daysSinceUpdate > 30) {
					this.logger.warn('🔴 [ExpoPushService] Token is stale', {
						userId: user.uid,
						daysSinceUpdate,
						lastUpdated: user.pushTokenUpdatedAt.toISOString()
					});
					return {
						needsRegistration: true,
						reason: `Token is ${daysSinceUpdate} days old (>30 days)`,
						serverToken,
						isValidFormat,
						tokensMatch,
					};
				}
			}

			// All checks passed
			this.logger.debug('✅ [ExpoPushService] Device registration is current and valid', {
				userId: user.uid,
				tokenAge: user.pushTokenUpdatedAt ? Math.floor((Date.now() - new Date(user.pushTokenUpdatedAt).getTime()) / (1000 * 60 * 60 * 24)) + ' days' : 'unknown'
			});
			
			return {
				needsRegistration: false,
				reason: 'Device registration is current and valid',
				serverToken,
				isValidFormat,
				tokensMatch,
			};
		} catch (error) {
			this.logger.error('❌ [ExpoPushService] Failed to check device registration status', {
				userId: user.uid,
				error: error.message,
				stack: error.stack
			});
			return {
				needsRegistration: true,
				reason: `Error checking registration: ${error.message}`,
				serverToken: user.expoPushToken || null,
				isValidFormat: false,
				tokensMatch: false,
			};
		}
	}

	/**
	 * Verify if a push token can receive notifications
	 */
	async verifyTokenDelivery(token: string): Promise<{
		canReceive: boolean;
		error?: string;
	}> {
		try {
			// Send a test notification to verify the token works
			const testMessage: ExpoPushMessage = {
				to: token,
				title: 'Connection Test',
				body: 'Testing push notification connectivity',
				data: { type: 'connectivity_test' },
				// Don't include sound field for silent notifications - Expo expects string or omitted
				badge: 0,
				priority: 'default',
			};

			const tickets = await this.sendPushNotifications([testMessage]);
			const ticket = tickets[0];

			if (ticket.status === 'ok') {
				this.logger.log(`✅ Token verification successful for: ${token.substring(0, 30)}...`);
				return { canReceive: true };
			} else {
				this.logger.warn(`⚠️ Token verification failed: ${ticket.message}`);
				return { 
					canReceive: false, 
					error: ticket.message || 'Unknown verification error' 
				};
			}
		} catch (error) {
			this.logger.error('❌ Failed to verify token delivery:', error);
			return { 
				canReceive: false, 
				error: error.message || 'Verification failed' 
			};
		}
	}

	/**
	 * Get device registration summary for user
	 */
	getDeviceRegistrationSummary(user: any): {
		hasToken: boolean;
		tokenValid: boolean;
		deviceInfo: {
			deviceId: string | null;
			platform: string | null;
			lastUpdated: string | null;
		};
		recommendAction: string;
	} {
		const hasToken = !!user.expoPushToken;
		const tokenValid = hasToken ? this.isValidExpoPushToken(user.expoPushToken) : false;
		
		let recommendAction = 'none';
		
		if (!hasToken) {
			recommendAction = 'register';
		} else if (!tokenValid) {
			recommendAction = 'reregister';
		} else {
			// Check if token is old
			if (user.pushTokenUpdatedAt) {
				const daysSinceUpdate = Math.floor(
					(Date.now() - new Date(user.pushTokenUpdatedAt).getTime()) / (1000 * 60 * 60 * 24)
				);
				
				if (daysSinceUpdate > 30) {
					recommendAction = 'refresh';
				}
			}
		}

		return {
			hasToken,
			tokenValid,
			deviceInfo: {
				deviceId: user.deviceId || null,
				platform: user.platform || null,
				lastUpdated: user.pushTokenUpdatedAt 
					? user.pushTokenUpdatedAt.toISOString() 
					: null,
			},
			recommendAction,
		};
	}
}
