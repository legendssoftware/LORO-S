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
    
    // If already a formatted string, return as-is to avoid double timezone conversion
    if (typeof date === 'string') {
        // Time format (HH:mm or HH:mm:ss) - already formatted by TimezoneUtil or date-fns
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(date.trim())) {
            return date;
        }
        // Pre-formatted date strings (contains commas, slashes, or ISO format)
        if (date.includes(',') || date.includes('/') || /^\d{4}-\d{2}-\d{2}/.test(date)) {
            return date;
        }
        // Already formatted with text (e.g., "Wednesday, January 8th, 2025")
        if (/[a-zA-Z]/.test(date) && date.length > 10) {
            return date;
        }
    }
    
    // Only parse and format if it's a Date object or needs formatting
    const dateObj = new Date(date);
    
    if (format === 'short') {
        return dateObj.toLocaleDateString('en-ZA', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    } else if (format === 'long') {
        return dateObj.toLocaleDateString('en-ZA', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    } else if (format === 'time') {
        return dateObj.toLocaleString('en-ZA', {
            hour: '2-digit',
            minute: '2-digit',
        });
    } else if (format === 'datetime') {
        return dateObj.toLocaleString('en-ZA', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    
    // Default format
    return dateObj.toLocaleDateString('en-ZA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
});

// Currency formatting helper
Handlebars.registerHelper('formatCurrency', function(amount: number, currency: string = 'USD') {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    // Return 0 if not a valid number
    if (typeof numAmount !== 'number' || isNaN(numAmount) || !isFinite(numAmount)) {
        return new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: currency,
        }).format(0);
    }
    
    return new Intl.NumberFormat('en-ZA', {
        style: 'currency',
        currency: currency,
    }).format(numAmount);
});

// Number formatting helper
Handlebars.registerHelper('formatNumber', function(number: number | string, decimals: number = 0) {
    // Convert string to number if needed
    const numValue = typeof number === 'string' ? parseFloat(number) : number;
    
    // Return original value if not a valid number
    if (typeof numValue !== 'number' || isNaN(numValue) || !isFinite(numValue)) {
        return '0';
    }
    
    // Ensure decimals is a valid number between 0 and 20 (NumberFormat limit)
    let validDecimals = 0;
    if (typeof decimals === 'number' && !isNaN(decimals) && isFinite(decimals)) {
        validDecimals = Math.max(0, Math.min(20, Math.floor(decimals)));
    }
    
    return new Intl.NumberFormat('en-ZA', {
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
    const numA = Number(a);
    const numB = Number(b);
    
    // Handle invalid numbers
    if (isNaN(numA) || isNaN(numB)) {
        return 0;
    }
    
    const result = numA + numB;
    
    // Handle infinity or NaN results
    if (!isFinite(result)) {
        return 0;
    }
    
    return result;
});

Handlebars.registerHelper('subtract', function(a: number, b: number) {
    const numA = Number(a);
    const numB = Number(b);
    
    // Handle invalid numbers
    if (isNaN(numA) || isNaN(numB)) {
        return 0;
    }
    
    const result = numA - numB;
    
    // Handle infinity or NaN results
    if (!isFinite(result)) {
        return 0;
    }
    
    return result;
});

Handlebars.registerHelper('multiply', function(a: number, b: number) {
    const numA = Number(a);
    const numB = Number(b);
    
    // Handle invalid numbers
    if (isNaN(numA) || isNaN(numB)) {
        return 0;
    }
    
    const result = numA * numB;
    
    // Handle infinity or NaN results
    if (!isFinite(result)) {
        return 0;
    }
    
    return result;
});

Handlebars.registerHelper('divide', function(a: number, b: number) {
    const numA = Number(a);
    const numB = Number(b);
    
    // Handle division by zero or invalid numbers
    if (isNaN(numA) || isNaN(numB) || numB === 0) {
        return 0;
    }
    
    const result = numA / numB;
    
    // Handle infinity or NaN results
    if (!isFinite(result)) {
        return 0;
    }
    
    return result;
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

// Switch statement helper for conditional rendering
Handlebars.registerHelper('switch', function(value: any, options: any) {
    this.switchValue = value;
    this.switchBreak = false;
    
    const content = options.fn(this);
    delete this.switchValue;
    delete this.switchBreak;
    
    return content;
});

// Case helper for switch statements
Handlebars.registerHelper('case', function(value: any, options: any) {
    if (this.switchBreak || this.switchValue !== value) {
        return '';
    }
    
    this.switchBreak = true;
    return options.fn(this);
});

// Default case helper for switch statements
Handlebars.registerHelper('default', function(options: any) {
    if (!this.switchBreak) {
        return options.fn(this);
    }
    
    return '';
});
