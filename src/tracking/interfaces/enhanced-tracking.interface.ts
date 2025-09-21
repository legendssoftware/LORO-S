/**
 * Enhanced Tracking Data Interfaces
 * Defines consistent data structures for comprehensive GPS tracking analytics
 */

export interface TripAnalysis {
	totalDistanceKm: number;
	formattedDistance: string;
	totalTimeMinutes: number;
	averageSpeedKmh: number;
	movingTimeMinutes: number;
	stoppedTimeMinutes: number;
	maxSpeedKmh: number;
	locationTimeSpent: Record<string, number>;
}

export interface StopData {
	latitude: number;
	longitude: number;
	address: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	durationFormatted: string;
	pointsCount: number;
	productivity?: 'High' | 'Medium' | 'Low' | 'Minimal';
}

export interface StopAnalysis {
	stops: StopData[];
	locations: Array<{
		address: string;
		latitude: number;
		longitude: number;
		timeSpentMinutes: number;
		timeSpentFormatted: string;
	}>;
	averageTimeMinutes: number;
	averageTimeFormatted: string;
}

export interface MovementEfficiency {
	efficiencyRating: 'High' | 'Medium' | 'Low';
	productivityScore: number;
	travelOptimization: {
		totalTravelDistance: number;
		optimizationScore: 'High' | 'Medium' | 'Low';
		suggestions: string[];
	};
}

export interface LocationProductivity {
	totalLocations: number;
	averageTimePerStop: number;
	productiveStops: number;
	keyLocations: Array<StopData & { productivity: string }>;
}

export interface TravelInsights {
	totalTravelDistance: number;
	travelEfficiency: {
		score: 'High' | 'Medium' | 'Low';
		metrics: {
			avgSpeed: number;
			maxSpeed: number;
			movingRatio: number;
		};
	};
	routeOptimization: {
		canOptimize: boolean;
		currentRouteDistance: number;
		optimizedRouteDistance: number;
		potentialSavings: number;
		recommendation: string;
	};
	movementPatterns: {
		pattern: string;
		peakMovementHour: number | null;
		peakMovementDistance: number;
		analysis: string;
		hourlyBreakdown: Array<{
			hour: number;
			distance: number;
			points: number;
		}>;
	};
}

export interface GeocodingStatus {
	successful: number;
	failed: number;
	usedFallback: boolean;
}

export interface EnhancedTrackingData {
	totalDistance: string;
	trackingPoints: any[];
	locationAnalysis: {
		locationsVisited: any[];
		averageTimePerLocation: string;
		averageTimePerLocationMinutes: number;
		timeSpentByLocation: Record<string, number>;
		averageTimePerLocationFormatted: string;
	};
	tripSummary: {
		totalDistanceKm: number;
		totalTimeMinutes: number;
		averageSpeedKmh: number;
		movingTimeMinutes: number;
		stoppedTimeMinutes: number;
		numberOfStops: number;
		maxSpeedKmh: number;
	};
	stops: StopData[];
	geocodingStatus: GeocodingStatus;
	movementEfficiency: MovementEfficiency;
	locationProductivity: LocationProductivity;
	travelInsights: TravelInsights;
}

export interface EnhancedTrackingResult {
	tripAnalysis: TripAnalysis;
	stopAnalysis: StopAnalysis;
	comprehensiveData: EnhancedTrackingData;
}

/**
 * Mobile Interface Data Structures
 */
export interface AttendanceRecordWithTrip extends Record<string, any> {
	uid: number;
	status: string;
	checkIn: Date;
	checkOut?: Date;
	duration?: string;
	// Enhanced trip data
	tripSummary?: {
		totalDistance: string;
		numberOfStops: number;
		averageSpeed: string;
		maxSpeed: string;
		movingTimeFormatted: string;
		stoppedTimeFormatted: string;
		totalTimeFormatted: string;
	};
	movementEfficiency?: MovementEfficiency;
	locationProductivity?: LocationProductivity;
	travelInsights?: TravelInsights;
	stops?: StopData[];
}

/**
 * Email Template Data Structures
 */
export interface EmailTrackingData {
	totalDistance: string;
	locations: any[];
	averageTimePerLocation: string;
	tripSummary: {
		totalDistanceKm: number;
		totalTimeFormatted: string;
		movingTimeFormatted: string;
		stoppedTimeFormatted: string;
		averageSpeedKmh: number;
		averageSpeed: string;
		maxSpeedKmh: number;
		maxSpeed: string;
		numberOfStops: number;
		movingTimeMinutes: number;
		stoppedTimeMinutes: number;
	};
	stops: Array<{
		address: string;
		latitude: number;
		longitude: number;
		duration: string;
		durationMinutes: number;
		startTime: string;
		endTime: string;
		pointsCount: number;
		isFallbackAddress: boolean;
	}>;
	movementEfficiency: {
		efficiencyRating: string;
		productivityScore: number;
		travelOptimization: {
			score: string;
			totalTravelDistance: number;
			suggestions: string[];
		};
	};
	locationProductivity: {
		totalLocations: number;
		averageTimePerStop: number;
		averageTimePerStopFormatted: string;
		productiveStops: number;
		productivityRatio: number;
		keyLocations: Array<{
			address: string;
			duration: string;
			productivity: string;
			startTime: string;
			endTime: string;
		}>;
	};
	travelInsights: {
		totalTravelDistance: number;
		travelEfficiency: {
			score: string;
			avgSpeed: number;
			maxSpeed: number;
			movingRatio: number;
		};
		routeOptimization: {
			canOptimize: boolean;
			currentRouteDistance: number;
			potentialSavings: number;
			recommendation: string;
		};
		movementPatterns: {
			pattern: string;
			peakMovementHour: number | null;
			peakMovementDistance: number;
			analysis: string;
		};
	};
	geocodingStatus: {
		successful: number;
		failed: number;
		usedFallback: boolean;
		note: string | null;
	};
}
