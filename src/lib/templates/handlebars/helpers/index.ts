import * as Handlebars from 'handlebars';

// Phone number formatting helper for tel: links
Handlebars.registerHelper('formatPhoneForTel', function(phone: string) {
    if (!phone) return '';
    // Remove all spaces, dashes, and parentheses for tel: links
    return phone.toString().replace(/[\s\-\(\)]/g, '');
});

// Date formatting helper
Handlebars.registerHelper('formatDate', function(date: string | Date, format?: string) {
    if (!date) return 'N/A';
    const dateObj = new Date(date);
    
    if (format === 'short') {
        return dateObj.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    } else if (format === 'long') {
        return dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    } else if (format === 'time') {
        return dateObj.toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
        });
    } else if (format === 'datetime') {
        return dateObj.toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    
    // Default format
    return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
});

// Currency formatting helper
Handlebars.registerHelper('formatCurrency', function(amount: number, currency: string = 'USD') {
    if (typeof amount !== 'number') return amount;
    
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
    }).format(amount);
});

// Number formatting helper
Handlebars.registerHelper('formatNumber', function(number: number | string, decimals: number = 0) {
    // Convert string to number if needed
    const numValue = typeof number === 'string' ? parseFloat(number) : number;
    
    // Return original value if not a valid number
    if (typeof numValue !== 'number' || isNaN(numValue)) {
        return number;
    }
    
    // Ensure decimals is a valid number between 0 and 20 (NumberFormat limit)
    const validDecimals = Math.max(0, Math.min(20, Math.floor(decimals)));
    
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: validDecimals,
        maximumFractionDigits: validDecimals,
    }).format(numValue);
});

// Comparison helpers for conditional rendering
Handlebars.registerHelper('gt', function(a: any, b: any) {
    return Number(a) > Number(b);
});

Handlebars.registerHelper('lt', function(a: any, b: any) {
    return Number(a) < Number(b);
});

Handlebars.registerHelper('gte', function(a: any, b: any) {
    return Number(a) >= Number(b);
});

Handlebars.registerHelper('lte', function(a: any, b: any) {
    return Number(a) <= Number(b);
});

Handlebars.registerHelper('eq', function(a: any, b: any) {
    return a === b;
});

Handlebars.registerHelper('ne', function(a: any, b: any) {
    return a !== b;
});

// Logical helpers
Handlebars.registerHelper('and', function(...args: any[]) {
    // Remove the options hash from the arguments
    const values = args.slice(0, -1);
    return values.every(Boolean);
});

Handlebars.registerHelper('or', function(...args: any[]) {
    // Remove the options hash from the arguments
    const values = args.slice(0, -1);
    return values.some(Boolean);
});

Handlebars.registerHelper('not', function(value: any) {
    return !value;
});

// String manipulation helpers
Handlebars.registerHelper('substring', function(str: string, start: number, end?: number) {
    if (!str) return '';
    return end !== undefined ? str.substring(start, end) : str.substring(start);
});

Handlebars.registerHelper('startsWith', function(str: string, prefix: string) {
    if (!str || !prefix) return false;
    return str.startsWith(prefix);
});

Handlebars.registerHelper('uppercase', function(str: string) {
    return str ? str.toUpperCase() : '';
});

Handlebars.registerHelper('lowercase', function(str: string) {
    return str ? str.toLowerCase() : '';
});

Handlebars.registerHelper('capitalize', function(str: string) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
});

// Array helpers
Handlebars.registerHelper('length', function(array: any) {
    if (!array) return 0;
    return Array.isArray(array) ? array.length : 0;
});

Handlebars.registerHelper('isEmpty', function(array: any) {
    if (!array) return true;
    return Array.isArray(array) ? array.length === 0 : true;
});

// Utility helpers
Handlebars.registerHelper('fallback', function(value: any, fallback: any) {
    return value || fallback;
});

Handlebars.registerHelper('concat', function(...args: any[]) {
    args.pop(); // Remove the options hash
    return args.join('');
});

// Priority/Status color helpers
Handlebars.registerHelper('priorityColor', function(priority: string) {
    switch (priority?.toUpperCase()) {
        case 'HIGH':
        case 'URGENT':
            return '#dc3545';
        case 'MEDIUM':
            return '#fd7e14';
        case 'LOW':
            return '#28a745';
        default:
            return '#6c757d';
    }
});

Handlebars.registerHelper('statusColor', function(status: string) {
    switch (status?.toUpperCase()) {
        case 'COMPLETED':
        case 'DONE':
        case 'APPROVED':
            return '#28a745';
        case 'IN_PROGRESS':
        case 'PENDING':
            return '#fd7e14';
        case 'FAILED':
        case 'REJECTED':
        case 'CANCELLED':
            return '#dc3545';
        default:
            return '#6c757d';
    }
});

// Math helpers
Handlebars.registerHelper('add', function(a: number, b: number) {
    return Number(a) + Number(b);
});

Handlebars.registerHelper('subtract', function(a: number, b: number) {
    return Number(a) - Number(b);
});

Handlebars.registerHelper('multiply', function(a: number, b: number) {
    return Number(a) * Number(b);
});

Handlebars.registerHelper('divide', function(a: number, b: number) {
    return Number(a) / Number(b);
});

Handlebars.registerHelper('percentage', function(value: number, total: number) {
    if (!total || total === 0) return 0;
    return Math.round((Number(value) / Number(total)) * 100);
});

// String contains helper
Handlebars.registerHelper('contains', function(str: string, searchStr: string) {
    if (!str || !searchStr) return false;
    return str.toString().includes(searchStr.toString());
});
