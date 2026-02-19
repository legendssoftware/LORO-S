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

/** Base shape for any map marker; payload is Leaflet-ready (position, markerType for styling). */
export interface MapMarkerBase {
	id: string | number;
	name: string;
	position: [number, number];
	latitude: number;
	longitude: number;
	markerType: string;
	[key: string]: any;
}

/** Lead marker from map report (markerType: 'lead'). */
export interface MapLeadMarkerType extends MapMarkerBase {
	markerType: 'lead';
	status?: string;
	timestamp?: string;
	leadData?: Record<string, any>;
	location?: { address?: string; imageUrl?: string };
	owner?: { uid: number; name: string };
	client?: { uid: number; name: string };
	interactionCount?: number;
}

/** Shift start marker (markerType: 'shift-start'). */
export interface MapShiftStartMarkerType extends MapMarkerBase {
	markerType: 'shift-start';
	status?: string;
	timestamp?: string;
	attendanceData?: Record<string, any>;
	owner?: { uid: number; name: string; phone?: string; photoURL?: string };
	location?: { address?: string; imageUrl?: string };
}

/** Shift end marker (markerType: 'shift-end'). */
export interface MapShiftEndMarkerType extends MapMarkerBase {
	markerType: 'shift-end';
	status?: string;
	timestamp?: string;
	duration?: number;
	attendanceData?: Record<string, any>;
	owner?: { uid: number; name: string; phone?: string; photoURL?: string };
	location?: { address?: string; imageUrl?: string };
}

/** Check-in / visit marker (markerType: 'check-in-visit'). */
export interface MapCheckInVisitMarkerType extends MapMarkerBase {
	markerType: 'check-in-visit';
	status?: string;
	timestamp?: string;
	checkInData?: Record<string, any>;
	owner?: { uid: number; name: string };
	client?: { uid: number; name: string };
	location?: { address?: string; imageUrl?: string };
}

/** Journal marker (markerType: 'journal'). */
export interface MapJournalMarkerType extends MapMarkerBase {
	markerType: 'journal';
	status?: string;
	timestamp?: string;
	journalData?: Record<string, any>;
	owner?: { uid: number; name: string };
	clientName?: string;
	location?: { address?: string; imageUrl?: string };
}

/** Task marker (markerType: 'task'). */
export interface MapTaskMarkerType extends MapMarkerBase {
	markerType: 'task';
	status?: string;
	timestamp?: string;
	taskData?: Record<string, any>;
	creator?: { uid: number; name: string };
	client?: { uid: number; name: string };
	location?: { address?: string; imageUrl?: string };
}

/** Claim marker (markerType: 'claim'). */
export interface MapClaimMarkerType extends MapMarkerBase {
	markerType: 'claim';
	status?: string;
	amount?: number;
	claimData?: Record<string, any>;
	owner?: { uid: number; name: string };
	location?: { address?: string };
}

export type MapMarkerUnion =
	| MapWorkerType
	| MapClientType
	| MapCompetitorType
	| MapQuotationType
	| MapLeadMarkerType
	| MapShiftStartMarkerType
	| MapShiftEndMarkerType
	| MapCheckInVisitMarkerType
	| MapJournalMarkerType
	| MapTaskMarkerType
	| MapClaimMarkerType
	| MapMarkerBase;

export interface MapDataResponse {
	workers: MapWorkerType[];
	clients: MapClientType[];
	competitors: MapCompetitorType[];
	quotations: MapQuotationType[];
	/** Lead markers with location (Leaflet-ready). */
	leads: MapLeadMarkerType[];
	/** Shift start locations (attendance). */
	shiftStarts: MapShiftStartMarkerType[];
	/** Shift end locations (attendance). */
	shiftEnds: MapShiftEndMarkerType[];
	/** Client visit / check-in locations. */
	checkIns: MapCheckInVisitMarkerType[];
	/** Journal entry markers (by client location). */
	journals?: MapJournalMarkerType[];
	/** Task markers (by client location). */
	tasks?: MapTaskMarkerType[];
	/** Claim markers. */
	claims?: MapClaimMarkerType[];
	/** All markers combined for Leaflet; filter client-side by markerType. */
	allMarkers: MapMarkerUnion[];
	events: MapEventType[];
	mapConfig: MapConfigType;
	/** Optional analytics/summary from generator. */
	analytics?: {
		totalMarkers: number;
		markerBreakdown?: Record<string, MapMarkerUnion[]>;
	};
}

