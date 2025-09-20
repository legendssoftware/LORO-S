export interface BulkEmailContent {
	subject: string;
	title?: string;
	greeting?: string;
	body: string;
	cta?: {
		text: string;
		url: string;
	};
	images?: EmailImage[];
	links?: EmailLink[];
	attachments?: EmailAttachment[];
	footer?: string;
}

export interface EmailImage {
	url: string;
	alt: string;
	title?: string;
	width?: number;
	height?: number;
	inline?: boolean; // For small images that can be inline with text
}

export interface EmailLink {
	text: string;
	url: string;
	description?: string;
}

export interface EmailAttachment {
	filename: string;
	path?: string;
	content?: Buffer;
	contentType?: string;
}

export interface BulkEmailInput {
	content: BulkEmailContent;
	recipientFilter?: {
		organizations?: string[];
		roles?: string[];
		status?: string[];
		excludeEmails?: string[];
	};
	sendOptions?: {
		dryRun?: boolean;
		batchSize?: number;
		delayBetweenBatches?: number;
	};
}

export interface BulkEmailResult {
	success: boolean;
	totalRecipients: number;
	successfulSends: number;
	failedSends: number;
	failedEmails: string[];
	messageIds: string[];
	executionTime: number;
	dryRun?: boolean;
}

export interface BulkAnnouncementEmailData {
	recipientName: string;
	recipientEmail: string;
	subject: string;
	title?: string;
	greeting?: string;
	body: string;
	cta?: {
		text: string;
		url: string;
	};
	images?: EmailImage[];
	links?: EmailLink[];
	footer?: string;
	companyName: string;
	appUrl: string;
	supportEmail: string;
	currentYear: number;
}
