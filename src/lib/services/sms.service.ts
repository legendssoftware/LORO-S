import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { SMSProvider, SMSType, SMSStatus } from '../enums/sms.enums';

export interface SendSMSOptions {
	to: string;
	message: string;
	type?: SMSType;
	metadata?: Record<string, any>;
}

export interface SMSResult {
	success: boolean;
	messageId?: string;
	status?: SMSStatus;
	error?: string;
	provider?: SMSProvider;
}

@Injectable()
export class SMSService {
	private readonly logger = new Logger(SMSService.name);
	private readonly provider: SMSProvider;
	private readonly apiKey: string;
	private readonly apiSecret: string;
	private readonly fromNumber: string;
	private twilioClient: AxiosInstance | null = null;
	private isEnabled: boolean = false;

	constructor(private readonly configService: ConfigService) {
		this.provider = (this.configService.get<string>('SMS_PROVIDER') || 'twilio') as SMSProvider;
		this.apiKey = this.configService.get<string>('SMS_API_KEY') || '';
		this.apiSecret = this.configService.get<string>('SMS_API_SECRET') || '';
		this.fromNumber = this.configService.get<string>('SMS_FROM_NUMBER') || '';

		// Check if SMS is enabled
		this.isEnabled = !!(this.apiKey && this.apiSecret && this.fromNumber);

		if (!this.isEnabled) {
			this.logger.warn('SMS service is not configured. SMS functionality will be disabled.');
			return;
		}

		this.initializeProvider();
	}

	/**
	 * Initialize the SMS provider client
	 */
	private initializeProvider(): void {
		try {
			switch (this.provider) {
				case SMSProvider.TWILIO:
					this.initializeTwilio();
					break;
				case SMSProvider.MESSAGEBIRD:
					this.initializeMessageBird();
					break;
				case SMSProvider.AFRICASTALKING:
					this.initializeAfricasTalking();
					break;
				default:
					this.logger.warn(`Unknown SMS provider: ${this.provider}. SMS functionality disabled.`);
					this.isEnabled = false;
			}
		} catch (error) {
			this.logger.error(`Failed to initialize SMS provider: ${error.message}`, error.stack);
			this.isEnabled = false;
		}
	}

	/**
	 * Initialize Twilio client
	 */
	private initializeTwilio(): void {
		const accountSid = this.apiKey;
		const authToken = this.apiSecret;

		if (!accountSid || !authToken) {
			this.logger.warn('Twilio credentials not configured');
			this.isEnabled = false;
			return;
		}

		// Create axios instance for Twilio API
		this.twilioClient = axios.create({
			baseURL: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`,
			auth: {
				username: accountSid,
				password: authToken,
			},
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		});

		this.logger.log('Twilio SMS service initialized');
	}

	/**
	 * Initialize MessageBird client (placeholder for future implementation)
	 */
	private initializeMessageBird(): void {
		this.logger.warn('MessageBird provider not yet implemented');
		this.isEnabled = false;
	}

	/**
	 * Initialize AfricasTalking client (placeholder for future implementation)
	 */
	private initializeAfricasTalking(): void {
		this.logger.warn('AfricasTalking provider not yet implemented');
		this.isEnabled = false;
	}

	/**
	 * Send SMS using the configured provider
	 */
	async sendSMS(options: SendSMSOptions): Promise<SMSResult> {
		if (!this.isEnabled) {
			this.logger.warn('SMS service is not enabled. Skipping SMS send.');
			return {
				success: false,
				status: SMSStatus.FAILED,
				error: 'SMS service is not configured',
				provider: this.provider,
			};
		}

		// Validate phone number
		const phoneNumber = this.normalizePhoneNumber(options.to);
		if (!phoneNumber) {
			return {
				success: false,
				status: SMSStatus.FAILED,
				error: 'Invalid phone number format',
				provider: this.provider,
			};
		}

		try {
			switch (this.provider) {
				case SMSProvider.TWILIO:
					return await this.sendViaTwilio(phoneNumber, options.message, options.type);
				case SMSProvider.MESSAGEBIRD:
					return await this.sendViaMessageBird(phoneNumber, options.message, options.type);
				case SMSProvider.AFRICASTALKING:
					return await this.sendViaAfricasTalking(phoneNumber, options.message, options.type);
				default:
					return {
						success: false,
						status: SMSStatus.FAILED,
						error: 'Unknown SMS provider',
						provider: this.provider,
					};
			}
		} catch (error) {
			this.logger.error(`Failed to send SMS: ${error.message}`, error.stack);
			return {
				success: false,
				status: SMSStatus.FAILED,
				error: error.message,
				provider: this.provider,
			};
		}
	}

	/**
	 * Send SMS via Twilio
	 */
	private async sendViaTwilio(to: string, message: string, type?: SMSType): Promise<SMSResult> {
		if (!this.twilioClient) {
			return {
				success: false,
				status: SMSStatus.FAILED,
				error: 'Twilio client not initialized',
				provider: SMSProvider.TWILIO,
			};
		}

		try {
			const params = new URLSearchParams({
				To: to,
				From: this.fromNumber,
				Body: message,
			});

			const response = await this.twilioClient.post('/Messages.json', params.toString());

			return {
				success: true,
				messageId: response.data.sid,
				status: SMSStatus.SENT,
				provider: SMSProvider.TWILIO,
			};
		} catch (error) {
			this.logger.error(`Twilio SMS send failed: ${error.message}`, error.stack);
			return {
				success: false,
				status: SMSStatus.FAILED,
				error: error.response?.data?.message || error.message,
				provider: SMSProvider.TWILIO,
			};
		}
	}

	/**
	 * Send SMS via MessageBird (placeholder)
	 */
	private async sendViaMessageBird(to: string, message: string, type?: SMSType): Promise<SMSResult> {
		// TODO: Implement MessageBird integration
		return {
			success: false,
			status: SMSStatus.FAILED,
			error: 'MessageBird not yet implemented',
			provider: SMSProvider.MESSAGEBIRD,
		};
	}

	/**
	 * Send SMS via AfricasTalking (placeholder)
	 */
	private async sendViaAfricasTalking(to: string, message: string, type?: SMSType): Promise<SMSResult> {
		// TODO: Implement AfricasTalking integration
		return {
			success: false,
			status: SMSStatus.FAILED,
			error: 'AfricasTalking not yet implemented',
			provider: SMSProvider.AFRICASTALKING,
		};
	}

	/**
	 * Normalize phone number to E.164 format
	 */
	private normalizePhoneNumber(phone: string): string | null {
		if (!phone) return null;

		// Remove all non-digit characters
		let cleaned = phone.replace(/\D/g, '');

		// Handle South African numbers (common use case)
		if (cleaned.startsWith('0')) {
			cleaned = '27' + cleaned.substring(1);
		} else if (!cleaned.startsWith('+') && !cleaned.startsWith('27')) {
			// Assume it's a local number, add country code
			cleaned = '27' + cleaned;
		}

		// Add + prefix for E.164 format
		if (!cleaned.startsWith('+')) {
			cleaned = '+' + cleaned;
		}

		// Basic validation (should be between 10-15 digits)
		const digitsOnly = cleaned.replace(/\D/g, '');
		if (digitsOnly.length < 10 || digitsOnly.length > 15) {
			return null;
		}

		return cleaned;
	}

	/**
	 * Check if SMS service is enabled
	 */
	isSMSEnabled(): boolean {
		return this.isEnabled;
	}

	/**
	 * Get current provider
	 */
	getProvider(): SMSProvider {
		return this.provider;
	}
}
