export class SalesTip {
	id: number;
	title: string;
	content: string;
	category: string;
	order: number;
	createdAt: Date;
}

export enum SalesTipCategory {
	MINDSET_PREPARATION = 'Mindset & Preparation',
	SALES_STRATEGY_TACTICS = 'Sales Strategy & Tactics',
	COMMUNICATION_RELATIONSHIP = 'Communication & Relationship Building',
	URGENCY_EDUCATION = 'Creating Urgency & Educating',
}
