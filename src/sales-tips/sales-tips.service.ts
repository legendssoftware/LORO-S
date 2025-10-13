import { Injectable, Logger } from '@nestjs/common';
import { CreateSalesTipDto } from './dto/create-sales-tip.dto';
import { UpdateSalesTipDto } from './dto/update-sales-tip.dto';
import { SalesTip, SalesTipCategory } from './entities/sales-tip.entity';

@Injectable()
export class SalesTipsService {
	private readonly logger = new Logger(SalesTipsService.name);
	
	// 30 BitDrywall Sales Tips from the image
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
	 * Get tip by date (deterministic based on date)
	 * This ensures users get the same tip on the same day
	 */
	getTipByDate(date: Date = new Date()): SalesTip {
		// Use date to calculate an index (same tip for same date)
		const dayOfYear = Math.floor(
			(date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24
		);
		const tipIndex = dayOfYear % this.salesTips.length;
		const tip = this.salesTips[tipIndex];
		this.logger.log(`💡 Selected tip for date ${date.toDateString()}: "${tip.title}" (Day ${dayOfYear}, Index ${tipIndex})`);
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
}
