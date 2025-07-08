export const formatDate = (date: Date): string => {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
    });
};

/**
 * Safely formats a date that might be a Date object or string
 * @param date - Date object, string, or null/undefined
 * @param fallback - Fallback string to return if date is invalid
 * @returns Formatted date string or fallback
 */
export const formatDateSafely = (date: Date | string | null | undefined, fallback: string = 'N/A'): string => {
    if (!date) {
        return fallback;
    }
    
    try {
        // If it's already a Date object, use it directly
        if (date instanceof Date) {
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
        
        // If it's a string, try to parse it into a Date
        if (typeof date === 'string') {
            const parsedDate = new Date(date);
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            }
        }
        
        return fallback;
    } catch (error) {
        console.warn('Error formatting date:', error);
        return fallback;
    }
}; 