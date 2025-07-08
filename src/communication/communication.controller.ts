import { Controller, Post, Body, Get } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('📱 Communication')
@Controller('communication')
export class CommunicationController {
	constructor(
		private readonly communicationService: CommunicationService,
	) {}

	@Post('send-app-update-notification')
	async sendAppUpdateNotification(@Body() body: { userEmails: string[] }) {
		// Example app update notification data
		const appUpdateData = {
			name: 'Team Member',
			appVersion: '2.1.0',
			appName: 'Loro Business Suite',
			organizationName: 'Your Organization',
			updateDate: new Date().toISOString(),
			updateTitle: 'Major Update with Exciting New Features!',
			updateDescription: 'We\'ve packed this update with incredible new features that will revolutionize how you work. From enhanced leads management to seamless PDF uploads, this update is designed to boost your productivity.',
			newFeatures: [
				{
					title: 'Advanced Leads Management',
					description: 'Comprehensive lead tracking, conversion analytics, and automated follow-ups to never miss an opportunity.',
					icon: '🎯'
				},
				{
					title: 'PDF File Uploads',
					description: 'Upload, organize, and share PDF documents directly within the app with advanced search capabilities.',
					icon: '📄'
				},
				{
					title: 'Real-time Collaboration',
					description: 'Work together with your team in real-time with live updates and instant notifications.',
					icon: '🤝'
				},
				{
					title: 'Enhanced Analytics Dashboard',
					description: 'Get deeper insights into your business performance with our new analytics engine.',
					icon: '📊'
				},
				{
					title: 'Mobile App Optimization',
					description: 'Faster performance, better battery life, and improved user experience on mobile devices.',
					icon: '📱'
				}
			],
			improvements: [
				{
					title: 'Faster Load Times',
					description: 'App now loads 60% faster with our new optimization algorithms.'
				},
				{
					title: 'Better User Interface',
					description: 'Cleaner, more intuitive design based on user feedback.'
				},
				{
					title: 'Enhanced Security',
					description: 'Additional security layers to protect your sensitive business data.'
				}
			],
			bugFixes: [
				{
					title: 'Login Issues Fixed',
					description: 'Resolved intermittent login problems reported by users.'
				},
				{
					title: 'Sync Improvements',
					description: 'Fixed data synchronization issues between mobile and web versions.'
				},
				{
					title: 'Performance Optimizations',
					description: 'Eliminated memory leaks and improved overall app stability.'
				}
			],
			criticalUpdate: true,
			forceUpdate: false,
			downloadUrls: {
				playStore: 'https://play.google.com/store/apps/details?id=com.loro.business',
				appStore: 'https://apps.apple.com/us/app/loro-business-suite/id123456789',
				directDownload: 'https://loro.com/download'
			},
			releaseNotes: 'This major update focuses on enhancing your business management capabilities with advanced leads tracking, seamless document management, and improved collaboration tools. We\'ve also addressed several user-reported issues and significantly improved app performance.',
			supportEmail: 'support@loro.com',
			supportPhone: '+1-800-LORO-HELP',
			dashboardUrl: 'https://app.loro.com/dashboard',
			updateDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(), // 30 days from now
			compatibilityInfo: 'This update is compatible with iOS 13.0+ and Android 8.0+. Please ensure your device meets these requirements.',
			backupReminder: 'We recommend backing up your important data before updating the app.',
			trainingResources: [
				{
					title: 'Getting Started with New Features',
					url: 'https://loro.com/training/new-features',
					type: 'video' as const
				},
				{
					title: 'Leads Management Guide',
					url: 'https://loro.com/guides/leads-management.pdf',
					type: 'pdf' as const
				},
				{
					title: 'PDF Upload Tutorial',
					url: 'https://loro.com/tutorials/pdf-uploads',
					type: 'link' as const
				}
			]
		};

		// Send the app update notification
		return await this.communicationService.sendAppUpdateNotification(body.userEmails, appUpdateData);
	}
}
