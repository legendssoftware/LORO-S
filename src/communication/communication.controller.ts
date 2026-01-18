import { Controller, Post, Body, Get } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { getDynamicDateTime, getFutureDateTime, createApiDescription } from '../lib/utils/swagger-helpers';

@ApiTags('📱 Communication')
@Controller('communication')
export class CommunicationController {
	constructor(
		private readonly communicationService: CommunicationService,
	) {}

	@Post('send-app-update-notification')
	@ApiOperation({
		summary: 'Send app update notification',
		description: createApiDescription(
			'Sends app update notifications to specified users via email and push notifications.',
			'The service method `CommunicationService.sendAppUpdateNotification()` processes the notification request, formats the update message, and sends notifications to all specified users.',
			'CommunicationService',
			'sendAppUpdateNotification',
			'sends app update notifications to users via email and push',
			'a confirmation object indicating successful notification delivery',
			['Email notifications', 'Push notifications', 'User targeting'],
		),
	})
	@ApiOkResponse({ description: 'Notifications sent successfully' })
	async sendAppUpdateNotification(@Body() body: { userEmails: string[] }) {
		// Example app update notification data
		const appUpdateData = {
			name: 'Team Member',
			appName: 'Loro Business Suite',
			version: '2.1.0',
			updateType: 'FEATURE' as const,
			releaseDate: new Date().toISOString(),
			features: [
				'Advanced Leads Management - Comprehensive lead tracking, conversion analytics, and automated follow-ups to never miss an opportunity.',
				'PDF File Uploads - Upload, organize, and share PDF documents directly within the app with advanced search capabilities.',
				'Real-time Collaboration - Work together with your team in real-time with live updates and instant notifications.',
				'Enhanced Analytics Dashboard - Get deeper insights into your business performance with our new analytics engine.',
				'Mobile App Optimization - Faster performance, better battery life, and improved user experience on mobile devices.'
			],
			bugFixes: [
				'Login Issues Fixed - Resolved intermittent login problems reported by users.',
				'Sync Improvements - Fixed data synchronization issues between mobile and web versions.',
				'Performance Optimizations - Eliminated memory leaks and improved overall app stability.'
			],
			securityUpdates: [
				'Enhanced Security - Additional security layers to protect your sensitive business data.'
			],
			downloadUrl: 'https://loro.com/download',
			updateUrl: 'https://app.loro.com/update',
			releaseNotes: 'This major update focuses on enhancing your business management capabilities with advanced leads tracking, seamless document management, and improved collaboration tools. We\'ve also addressed several user-reported issues and significantly improved app performance.',
			isForced: false,
			supportEmail: 'support@loro.com',
			rolloutPercentage: 100,
			targetPlatforms: ['iOS', 'Android', 'Web'],
			minimumVersion: '2.0.0',
			compatibility: {
				os: ['iOS 13.0+', 'Android 8.0+'],
				devices: ['iPhone', 'iPad', 'Android Phone', 'Android Tablet'],
				browsers: ['Chrome', 'Safari', 'Firefox', 'Edge']
			},
			updateInstructions: [
				'Close the app completely before updating',
				'Ensure you have sufficient storage space (minimum 500MB)',
				'Connect to a stable internet connection',
				'Backup your data before proceeding'
			],
			troubleshootingLink: 'https://loro.com/support/troubleshooting',
			systemRequirements: {
				ram: '4GB minimum, 8GB recommended',
				storage: '500MB free space required',
				processor: 'Dual-core 1.8GHz or faster',
				other: ['GPS capability for location features', 'Camera access for document scanning']
			},
			backupRecommendation: true,
			maintenanceWindow: {
				start: getFutureDateTime(30, 2, 0),
				end: getFutureDateTime(30, 4, 0),
				timezone: 'UTC'
			},
			contactInfo: {
				supportEmail: 'support@loro.com',
				supportPhone: '+1-800-LORO-HELP',
				documentationUrl: 'https://docs.loro.com'
			}
		};

		// Send the app update notification
		return await this.communicationService.sendAppUpdateNotification(body.userEmails, appUpdateData);
	}
}
