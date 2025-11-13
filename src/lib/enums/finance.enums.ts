export enum ClaimStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    PAID = 'paid',
    CANCELLED = 'cancelled',
    DECLINED = 'declined',
    DELETED = 'deleted',
}

export enum ClaimCategory {
    GENERAL = 'general',
    TRAVEL = 'travel',
    TRANSPORT = 'transport',
    ACCOMMODATION = 'accommodation',
    MEALS = 'meals',
    ENTERTAINMENT = 'entertainment',
    HOTEL = 'hotel',
    OTHER = 'other',
    PROMOTION = 'promotion',
    EVENT = 'event',
    ANNOUNCEMENT = 'announcement',
    TRANSPORTATION = 'transportation',
    OTHER_EXPENSES = 'other expenses',
}

export enum InvoiceStatus {
    PENDING = 'pending',
    PAID = 'paid',
    CANCELLED = 'cancelled',
}

export enum Currency {
    ZAR = 'ZAR', // South African Rand
    USD = 'USD', // US Dollar
    EUR = 'EUR', // Euro
    GBP = 'GBP', // British Pound
    AUD = 'AUD', // Australian Dollar
    CAD = 'CAD', // Canadian Dollar
    CHF = 'CHF', // Swiss Franc
    JPY = 'JPY', // Japanese Yen
    CNY = 'CNY', // Chinese Yuan
    INR = 'INR', // Indian Rupee
    BWP = 'BWP', // Botswana Pula
    ZMW = 'ZMW', // Zambian Kwacha
    MZN = 'MZN', // Mozambican Metical
    NGN = 'NGN', // Nigerian Naira
    KES = 'KES', // Kenyan Shilling
    TZS = 'TZS', // Tanzanian Shilling
    UGX = 'UGX', // Ugandan Shilling
    ETB = 'ETB', // Ethiopian Birr
    GHS = 'GHS', // Ghanaian Cedi
} 