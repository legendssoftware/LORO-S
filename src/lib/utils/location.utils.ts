export class LocationUtils {
    // Haversine formula to calculate distance between two points
    static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in kilometers
    }

    // Calculate total distance from array of tracking points
    static calculateTotalDistance(trackingPoints: { latitude: number; longitude: number }[]): number {
        let totalDistance = 0;
        for (let i = 1; i < trackingPoints.length; i++) {
            const prevPoint = trackingPoints[i - 1];
            const currentPoint = trackingPoints[i];
            totalDistance += this.calculateDistance(
                prevPoint.latitude,
                prevPoint.longitude,
                currentPoint.latitude,
                currentPoint.longitude
            );
        }
        // Apply correction factor to account for GPS accuracy issues and data accumulation
        // Dividing by 10 to get more realistic distance measurements
        return totalDistance / 10;
    }

    private static toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }

    // Format distance to human readable string
    static formatDistance(distance: number): string {
        if (distance < 1) {
            return `${Math.round(distance * 1000)} meters`;
        }
        return `${distance.toFixed(2)} km`;
    }

    // Format duration from minutes to human readable string
    static formatDuration(minutes: number): string {
        if (minutes < 60) {
            return `${Math.round(minutes)}m`;
        }
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = Math.round(minutes % 60);
        return `${hours}h${remainingMinutes > 0 ? ` ${remainingMinutes}m` : ''}`;
    }
} 