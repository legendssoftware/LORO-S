/**
 * Type definitions for map data to ensure synchronization with client-side types
 */

export interface MapWorkerType {
	id: string;
	name: string;
	status: string;
	position: [number, number];
	latitude: number;
	longitude: number;
	markerType: string;
	image?: string;
	canAddTask?: boolean;
	task?: {
		id: string;
		title: string;
		client: string;
	};
	location: {
		address: string;
		imageUrl?: string;
	};
	schedule: {
		current: string;
		next: string;
	};
	jobStatus?: {
		startTime: string;
		endTime: string;
		duration: string;
		status: string;
		completionPercentage: number;
	};
	breakData?: {
		startTime: string;
		endTime: string;
		duration: string;
		location: string;
		remainingTime: string;
	};
	activity?: {
		claims: number;
		journals: number;
		leads: number;
		checkIns: number;
		tasks: number;
		quotations: number;
	};
	checkInTime?: string;
}

export interface MapClientType {
	id: number;
	name: string;
	position: [number, number];
	latitude: number;
	longitude: number;
	clientRef: string;
	contactName?: string;
	email?: string;
	phone?: string;
	alternativePhone?: string;
	status: string;
	website?: string;
	logo?: string;
	logoUrl?: string;
	address: any;
	markerType: string;
	// Enhanced client fields
	description?: string;
	industry?: string;
	companySize?: number;
	annualRevenue?: number;
	creditLimit?: number;
	outstandingBalance?: number;
	lifetimeValue?: number;
	priceTier?: string;
	riskLevel?: string;
	satisfactionScore?: number;
	npsScore?: number;
	preferredContactMethod?: string;
	preferredPaymentMethod?: string;
	paymentTerms?: string;
	discountPercentage?: number;
	lastVisitDate?: Date | string;
	nextContactDate?: Date | string;
	acquisitionChannel?: string;
	acquisitionDate?: Date | string;
	birthday?: Date | string;
	anniversaryDate?: Date | string;
	tags?: string[];
	visibleCategories?: string[];
	socialProfiles?: {
		linkedin?: string;
		twitter?: string;
		facebook?: string;
		instagram?: string;
	};
	socialMedia?: any;
	customFields?: Record<string, any>;
	assignedSalesRep?: {
		uid: number;
		name: string;
	};
	geofencing?: {
		enabled: boolean;
		type: string;
		radius: number;
	};
	createdAt?: Date | string;
	updatedAt?: Date | string;
}

export interface MapCompetitorType {
	id: number;
	name: string;
	position: [number, number];
	latitude: number;
	longitude: number;
	markerType: string;
	threatLevel?: number;
	isDirect?: boolean;
	industry?: string;
	status: string;
	website?: string;
	logoUrl?: string;
	competitorRef: string;
	address: any;
	// Enhanced competitor fields
	description?: string;
	contactEmail?: string;
	contactPhone?: string;
	marketSharePercentage?: number;
	estimatedAnnualRevenue?: number;
	estimatedEmployeeCount?: number;
	competitiveAdvantage?: number;
	foundedDate?: Date | string;
	keyProducts?: string[];
	keyStrengths?: string[];
	keyWeaknesses?: string[];
	pricingData?: {
		lowEndPricing?: number;
		midRangePricing?: number;
		highEndPricing?: number;
		pricingModel?: string;
	};
	businessStrategy?: string;
	marketingStrategy?: string;
	socialMedia?: {
		linkedin?: string;
		twitter?: string;
		facebook?: string;
		instagram?: string;
	};
	geofencing?: {
		enabled: boolean;
		type: string;
		radius: number;
	};
	createdBy?: {
		uid: number;
		name: string;
	};
	createdAt?: Date | string;
	updatedAt?: Date | string;
}

export interface MapQuotationType {
	id: number;
	quotationNumber: string;
	clientName: string;
	position: [number, number];
	latitude: number;
	longitude: number;
	totalAmount: number;
	status: string;
	quotationDate: string | Date;
	placedBy: string;
	isConverted: boolean;
	validUntil?: string | Date;
	markerType: string;
}

export interface MapEventType {
	id: string | number;
	type: string;
	userId?: number;
	userName?: string;
	timestamp?: string;
	location?:
		| string
		| {
				lat: number;
				lng: number;
				address: string;
				imageUrl?: string;
		  };
	details?: string;
	title?: string;
	time?: string;
	user?: string;
	amount?: string;
	currency?: string;
}

export interface MapConfigType {
	defaultCenter: { lat: number; lng: number };
	orgRegions: Array<{
		name: string;
		center: { lat: number; lng: number };
		zoom: number;
	}>;
}

export interface MapDataResponse {
	workers: MapWorkerType[];
	clients: MapClientType[];
	competitors: MapCompetitorType[];
	quotations: MapQuotationType[];
	events: MapEventType[];
	mapConfig: MapConfigType;
}

