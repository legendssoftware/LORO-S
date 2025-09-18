export enum JournalStatus {
    DRAFT = 'DRAFT',
    PUBLISHED = 'PUBLISHED',
    ARCHIVED = 'ARCHIVED',
    PENDING_REVIEW = 'PENDING_REVIEW',
    REJECTED = 'REJECTED'
}

export enum JournalType {
    GENERAL = 'GENERAL',
    INSPECTION = 'INSPECTION',
    AUDIT = 'AUDIT',
    CHECKLIST = 'CHECKLIST',
    REPORT = 'REPORT'
}

export enum InspectionRating {
    EXCELLENT = 'EXCELLENT',
    GOOD = 'GOOD',
    AVERAGE = 'AVERAGE',
    POOR = 'POOR',
    CRITICAL = 'CRITICAL'
}

// Interfaces for inspection form data structure
export interface InspectionItem {
    id: string;
    name: string;
    score?: number; // 1-5 scale
    notes?: string;
    required: boolean;
}

export interface InspectionCategory {
    id: string;
    name: string;
    items: InspectionItem[];
    weight?: number; // For weighted scoring
}

export interface InspectionFormData {
    categories: InspectionCategory[];
    totalScore?: number;
    maxScore?: number;
    percentage?: number;
    overallRating?: InspectionRating;
    inspectorComments?: string;
    storeManagerSignature?: string;
    qcInspectorSignature?: string;
    inspectionDate?: Date;
    completedBy?: number; // User ID
} 