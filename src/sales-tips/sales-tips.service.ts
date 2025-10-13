import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSalesTipDto } from './dto/create-sales-tip.dto';
import { UpdateSalesTipDto } from './dto/update-sales-tip.dto';
import { SalesTip, SalesTipCategory } from './entities/sales-tip.entity';
import { User } from '../user/entities/user.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationPriority, NotificationChannel } from '../lib/types/unified-notification.types';

@Injectable()
export class SalesTipsService {
	private readonly logger = new Logger(SalesTipsService.name);
	
	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly unifiedNotificationService: UnifiedNotificationService,
	) {}
	
	// Expanded BitDrywall Sales Tips collection
	private readonly salesTips: SalesTip[] = [
		// Mindset & Preparation (5 tips: 1-5)
		{
			id: 1,
			title: 'Be a construction problem-solver, not a seller',
			content: 'Every customer is building something—find what they\'re trying to achieve and guide them.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 1,
			createdAt: new Date(),
		},
		{
			id: 2,
			title: 'Know every product\'s real-life application',
			content: 'Understand where each item (board, screw, frame, or adhesive) is used—this builds instant trust.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 2,
			createdAt: new Date(),
		},
		{
			id: 3,
			title: 'Memorize pricing tiers and promotions',
			content: 'When clients see confidence, they don\'t negotiate as hard.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 3,
			createdAt: new Date(),
		},
		{
			id: 4,
			title: 'Start every day with a clear target',
			content: 'Calls, invoices, number of boards sold—set specific daily goals.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 4,
			createdAt: new Date(),
		},
		{
			id: 5,
			title: 'Understand your competitors\' weak points',
			content: 'Know Builders, Buco, CashBuild, etc.—so you can emphasize where BitDrywall wins (better service, faster delivery, flexible deals).',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 5,
			createdAt: new Date(),
		},
		// Communication & Relationship Building (7 tips: 7-13)
		{
			id: 7,
			title: 'Greet every customer the moment they enter',
			content: 'The first 10 seconds decide if they\'ll buy or leave.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 7,
			createdAt: new Date(),
		},
		{
			id: 8,
			title: 'Ask open questions',
			content: 'What project are you working on? Ceilings or partitions? How many rooms?',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 8,
			createdAt: new Date(),
		},
		{
			id: 9,
			title: 'Talk solutions, not prices',
			content: 'This board won\'t crack under humidity—sells better than "It\'s R190."',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 9,
			createdAt: new Date(),
		},
		{
			id: 10,
			title: 'Match their language',
			content: 'Speak technically with contractors, simply with homeowners.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 10,
			createdAt: new Date(),
		},
		{
			id: 11,
			title: 'Always repeat their needs',
			content: 'So, you need 2000+ of RhinoBoard for a school project? —this shows attention.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 11,
			createdAt: new Date(),
		},
		{
			id: 12,
			title: 'Follow up quotes within 24 hours',
			content: 'Call or WhatsApp—clients appreciate responsiveness.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 12,
			createdAt: new Date(),
		},
		{
			id: 13,
			title: 'Upsell based on quality',
			content: 'This adhesive costs R30 more, but it lasts double.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 13,
			createdAt: new Date(),
		},
		// Sales Strategy & Tactics (4 tips: 14, 16-18)
		{
			id: 14,
			title: 'Bundle sales',
			content: 'When selling boards, add screws, tape, and jointing compound—don\'t let clients buy half the solution.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 14,
			createdAt: new Date(),
		},
		{
			id: 16,
			title: 'Use "Good-Better-Best" pricing',
			content: 'Offer three options—the middle one sells best.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 16,
			createdAt: new Date(),
		},
		{
			id: 17,
			title: 'Push high-margin items',
			content: 'Drywall screws, adhesives, and cornices often add 20-60% profit.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 17,
			createdAt: new Date(),
		},
		{
			id: 18,
			title: 'Offer free delivery or discounts for large quantities',
			content: 'Incentivize volume purchases.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 18,
			createdAt: new Date(),
		},
		// Creating Urgency & Educating (4 tips: 23, 24, 29, 30)
		{
			id: 23,
			title: 'Create urgency with project timelines',
			content: 'Boards are going up in price next week—order now and save.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 23,
			createdAt: new Date(),
		},
		{
			id: 24,
			title: 'Turn problems into opportunities',
			content: 'Handle complaints calmly, then offer a free sample or next purchase discount.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 24,
			createdAt: new Date(),
		},
		{
			id: 29,
			title: 'Educate your customers',
			content: 'Teach them about acoustic boards, insulation options, or fire-rated systems—build long-term trust, not just one sale.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 29,
			createdAt: new Date(),
		},
		{
			id: 30,
			title: 'Celebrate project milestones',
			content: 'Congrats on completing that clinic job!—build emotional connection with the customer.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 30,
			createdAt: new Date(),
		},
		// New Sales-Focused Tips (31-50) - Closing, Communication, Ethics, Relationships, Targets & App Usage
		{
			id: 31,
			title: 'Ask for the sale directly',
			content: 'Don\'t dance around it. After presenting value, ask: "Can we process this order today?" Confidence closes deals.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 31,
			createdAt: new Date(),
		},
		{
			id: 32,
			title: 'Use trial closes throughout the conversation',
			content: 'Ask questions like "Does this solution work for your timeline?" to gauge readiness before the final ask.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 32,
			createdAt: new Date(),
		},
		{
			id: 33,
			title: 'Handle objections with empathy',
			content: 'When they say "it\'s too expensive," respond: "I understand budget is important. Let\'s look at what you\'re getting for the investment."',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 33,
			createdAt: new Date(),
		},
		{
			id: 34,
			title: 'Never bad-mouth competitors',
			content: 'Maintain professionalism. Focus on your strengths, not their weaknesses. Ethical selling builds trust.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 34,
			createdAt: new Date(),
		},
		{
			id: 35,
			title: 'Check your client list daily in the app',
			content: 'Start each morning reviewing who needs follow-up. The app shows purchase history—use it to prepare personalized outreach.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 35,
			createdAt: new Date(),
		},
		{
			id: 36,
			title: 'Listen more than you talk',
			content: 'The 70/30 rule: Let customers talk 70% of the time. You\'ll discover their real needs and build rapport.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 36,
			createdAt: new Date(),
		},
		{
			id: 37,
			title: 'Master the assumptive close',
			content: 'Act as if they\'ve already decided: "When would you like this delivered?" This subtly moves them toward commitment.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 37,
			createdAt: new Date(),
		},
		{
			id: 38,
			title: 'Track your daily call targets',
			content: 'Set a goal for calls made each day. Use the app to log them and analyze which call times get the best response.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 38,
			createdAt: new Date(),
		},
		{
			id: 39,
			title: 'Build relationships, not just transactions',
			content: 'Remember personal details: their kids\' names, project challenges. This creates loyalty beyond pricing.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 39,
			createdAt: new Date(),
		},
		{
			id: 40,
			title: 'Always be honest about delivery times',
			content: 'Under-promise and over-deliver. If it takes 5 days, say 7. Trust is destroyed by missed expectations.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 40,
			createdAt: new Date(),
		},
		{
			id: 41,
			title: 'Use the app to identify buying patterns',
			content: 'Check customer purchase history to predict needs. If they buy boards every 3 months, reach out proactively.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 41,
			createdAt: new Date(),
		},
		{
			id: 42,
			title: 'Close on smaller commitments first',
			content: 'Can\'t get them to buy 1000+ boards? Start with: "Can we at least send you a sample?" Baby steps close bigger deals.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 42,
			createdAt: new Date(),
		},
		{
			id: 43,
			title: 'Mirror their communication style',
			content: 'If they text, text back. If they call, call them. Match their pace and energy level for better connection.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 43,
			createdAt: new Date(),
		},
		{
			id: 44,
			title: 'Set weekly revenue targets, not just monthly',
			content: 'Break big goals into weekly chunks. Track progress in the app to stay motivated and adjust tactics mid-month.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 44,
			createdAt: new Date(),
		},
		{
			id: 45,
			title: 'Never pressure—guide',
			content: 'High-pressure tactics damage relationships. Instead, help them make informed decisions. Good sales feel like good advice.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 45,
			createdAt: new Date(),
		},
		{
			id: 46,
			title: 'Send thank-you messages after sales',
			content: 'A quick "Thanks for your order!" message builds goodwill. Use the app to automate reminders for this.',
			category: SalesTipCategory.COMMUNICATION_RELATIONSHIP,
			order: 46,
			createdAt: new Date(),
		},
		{
			id: 47,
			title: 'Ask for referrals from happy customers',
			content: 'After successful projects, ask: "Do you know anyone else who might need our services?" Referrals are warm leads.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 47,
			createdAt: new Date(),
		},
		{
			id: 48,
			title: 'Review your app metrics weekly',
			content: 'Check conversion rates, average deal size, and follow-up speed. Use data to identify where you can improve.',
			category: SalesTipCategory.MINDSET_PREPARATION,
			order: 48,
			createdAt: new Date(),
		},
		{
			id: 49,
			title: 'Be transparent about product limitations',
			content: 'If a product isn\'t ideal for their need, say so. Recommending the right solution builds credibility and repeat business.',
			category: SalesTipCategory.URGENCY_EDUCATION,
			order: 49,
			createdAt: new Date(),
		},
		{
			id: 50,
			title: 'End every call with a clear next step',
			content: 'Never leave things vague. Confirm: "I\'ll send the quote by 2pm, and we\'ll touch base tomorrow morning." Use the app to set task reminders.',
			category: SalesTipCategory.SALES_STRATEGY_TACTICS,
			order: 50,
			createdAt: new Date(),
		},
	];

	/**
	 * Get a random sales tip of the day
	 */
	getTipOfTheDay(): SalesTip {
		const randomIndex = Math.floor(Math.random() * this.salesTips.length);
		const tip = this.salesTips[randomIndex];
		this.logger.log(`💡 Selected random tip of the day: "${tip.title}"`);
		return tip;
	}

	/**
	 * Get tip by date with randomization
	 * Uses date + milliseconds for better randomization on each call
	 */
	getTipByDate(date: Date = new Date()): SalesTip {
		// Combine day of year with current time for better randomization
		const dayOfYear = Math.floor(
			(date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24
		);
		const timeComponent = Date.now();
		const randomSeed = dayOfYear + timeComponent;
		const tipIndex = Math.floor(Math.random() * this.salesTips.length + randomSeed) % this.salesTips.length;
		const tip = this.salesTips[tipIndex];
		this.logger.log(`💡 Selected randomized tip for date ${date.toDateString()}: "${tip.title}" (Day ${dayOfYear}, Random Index ${tipIndex})`);
		return tip;
	}

	/**
	 * Get all tips
	 */
	findAll(): SalesTip[] {
		return this.salesTips;
	}

	/**
	 * Get tip by ID
	 */
	findOne(id: number): SalesTip | undefined {
		return this.salesTips.find(tip => tip.id === id);
	}

	/**
	 * Get tips by category
	 */
	findByCategory(category: SalesTipCategory): SalesTip[] {
		return this.salesTips.filter(tip => tip.category === category);
	}

	create(createSalesTipDto: CreateSalesTipDto) {
		return 'This action adds a new salesTip';
	}

	update(id: number, updateSalesTipDto: UpdateSalesTipDto) {
		return `This action updates a #${id} salesTip`;
	}

	remove(id: number) {
		return `This action removes a #${id} salesTip`;
	}

	/**
	 * Send sales tip to all active users across all organizations
	 */
	async sendSalesTipToAllUsers(): Promise<void> {
		const operationId = `sales_tip_broadcast_${Date.now()}`;
		this.logger.log(`🚀 [${operationId}] Starting sales tip broadcast to all users`);

		try {
			// Get all active users from all organizations
			const activeUsers = await this.userRepository.find({
				where: {
					status: 'active',
					isDeleted: false,
				},
				relations: ['organisation', 'branch'],
			});

			if (!activeUsers || activeUsers.length === 0) {
				this.logger.warn(`⚠️ [${operationId}] No active users found to send sales tips`);
				return;
			}

			this.logger.log(`📊 [${operationId}] Found ${activeUsers.length} active users across all organizations`);

			// Get a random tip for this broadcast
			const tip = this.getTipOfTheDay();
			this.logger.log(`💡 [${operationId}] Selected tip: "${tip.title}"`);

			// Send notifications in batches to avoid overwhelming the system
			const batchSize = 50;
			let successCount = 0;
			let failCount = 0;

			for (let i = 0; i < activeUsers.length; i += batchSize) {
				const batch = activeUsers.slice(i, i + batchSize);
				const batchNumber = Math.floor(i / batchSize) + 1;
				const totalBatches = Math.ceil(activeUsers.length / batchSize);
				
				this.logger.debug(`📤 [${operationId}] Processing batch ${batchNumber}/${totalBatches} (${batch.length} users)`);

				// Send to each user in the batch
				const batchPromises = batch.map(async (user) => {
					try {
						await this.unifiedNotificationService.sendNotification({
							event: 'SALES_TIP_OF_THE_DAY' as any,
							title: `💡 Sales Tip: ${tip.title}`,
							message: tip.content,
							priority: NotificationPriority.NORMAL,
							channel: NotificationChannel.GENERAL,
							recipients: [{ userId: user.uid }],
							data: {
								type: 'sales_tip',
								screen: 'SalesTips',
								metadata: {
									tipId: tip.id,
									category: tip.category,
									title: tip.title,
								},
							},
							push: {
								sound: 'default',
								badge: 1,
							},
						});
						successCount++;
						this.logger.debug(`✅ [${operationId}] Sent tip to user ${user.uid} (${user.name} ${user.surname})`);
					} catch (error) {
						failCount++;
						this.logger.warn(`❌ [${operationId}] Failed to send tip to user ${user.uid}: ${error.message}`);
					}
				});

				await Promise.allSettled(batchPromises);

				// Small delay between batches to prevent rate limiting
				if (i + batchSize < activeUsers.length) {
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}

			this.logger.log(
				`✅ [${operationId}] Sales tip broadcast completed: ${successCount} successful, ${failCount} failed out of ${activeUsers.length} total users`
			);
		} catch (error) {
			this.logger.error(`❌ [${operationId}] Error broadcasting sales tips:`, error.stack);
		}
	}

	/**
	 * Cron job: Send sales tip at 10:00 AM every working day (Monday-Friday)
	 * Timezone: Africa/Johannesburg (South Africa)
	 */
	@Cron('0 10 * * 1-5', {
		name: 'morning-sales-tip',
		timeZone: 'Africa/Johannesburg',
	})
	async sendMorningSalesTip() {
		this.logger.log('⏰ Morning Sales Tip Cron Job triggered (10:00 AM, Mon-Fri)');
		await this.sendSalesTipToAllUsers();
	}

	/**
	 * Cron job: Send sales tip at 1:00 PM every working day (Monday-Friday)
	 * Timezone: Africa/Johannesburg (South Africa)
	 */
	@Cron('0 13 * * 1-5', {
		name: 'afternoon-sales-tip',
		timeZone: 'Africa/Johannesburg',
	})
	async sendAfternoonSalesTip() {
		this.logger.log('⏰ Afternoon Sales Tip Cron Job triggered (1:00 PM, Mon-Fri)');
		await this.sendSalesTipToAllUsers();
	}

	/**
	 * Manual trigger for testing purposes
	 */
	async triggerManualSalesTip(): Promise<{ message: string; success: boolean }> {
		this.logger.log('🔧 Manual sales tip trigger initiated');
		try {
			await this.sendSalesTipToAllUsers();
			return {
				success: true,
				message: 'Sales tip sent successfully to all active users',
			};
		} catch (error) {
			this.logger.error('Failed to send manual sales tip:', error);
			return {
				success: false,
				message: `Failed to send sales tip: ${error.message}`,
			};
		}
	}
}
