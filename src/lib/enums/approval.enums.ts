export enum ApprovalType {
    // Document Approvals
    INVOICE = 'invoice',
    QUOTATION = 'quotation',
    CONTRACT = 'contract',
    REPORT = 'report',
    PROPOSAL = 'proposal',
    POLICY = 'policy',
    
    // HR & Leave Approvals
    LEAVE_REQUEST = 'leave_request',
    OVERTIME = 'overtime',
    EXPENSE_CLAIM = 'expense_claim',
    REIMBURSEMENT = 'reimbursement',
    TRAVEL_REQUEST = 'travel_request',
    
    // Operational Approvals
    PURCHASE_ORDER = 'purchase_order',
    BUDGET_REQUEST = 'budget_request',
    ASSET_ASSIGNMENT = 'asset_assignment',
    ASSET_TRANSFER = 'asset_transfer',
    
    // User & Access Approvals
    USER_ACCESS = 'user_access',
    ROLE_CHANGE = 'role_change',
    DEPARTMENT_TRANSFER = 'department_transfer',
    
    // Client & Sales Approvals
    CLIENT_REGISTRATION = 'client_registration',
    DISCOUNT_REQUEST = 'discount_request',
    CREDIT_LIMIT = 'credit_limit',
    PAYMENT_TERMS = 'payment_terms',
    
    // System & Technical Approvals
    SYSTEM_CHANGE = 'system_change',
    DATA_EXPORT = 'data_export',
    INTEGRATION_REQUEST = 'integration_request',
    
    // General Approvals
    GENERAL = 'general',
    OTHER = 'other'
}

export enum ApprovalStatus {
    // Initial States
    DRAFT = 'draft',                    // Being prepared, not yet submitted
    PENDING = 'pending',                // Awaiting approval
    SUBMITTED = 'submitted',            // Formally submitted for review
    
    // Review States
    UNDER_REVIEW = 'under_review',      // Currently being reviewed
    ADDITIONAL_INFO_REQUIRED = 'additional_info_required', // More information needed
    REVISED = 'revised',                // Revised and resubmitted
    
    // Decision States
    APPROVED = 'approved',              // Approved and ready for action
    CONDITIONALLY_APPROVED = 'conditionally_approved', // Approved with conditions
    REJECTED = 'rejected',              // Rejected
    DECLINED = 'declined',              // Politely declined
    
    // Completion States
    SIGNED = 'signed',                  // Digitally signed
    IMPLEMENTED = 'implemented',        // Action completed
    COMPLETED = 'completed',            // Fully completed
    
    // Administrative States
    WITHDRAWN = 'withdrawn',            // Withdrawn by requester
    CANCELLED = 'cancelled',            // Cancelled by system/admin
    EXPIRED = 'expired',                // Expired due to time limits
    ESCALATED = 'escalated',            // Escalated to higher authority
    ON_HOLD = 'on_hold',               // Temporarily on hold
    
    // Error States
    FAILED = 'failed',                  // Technical failure
    INVALID = 'invalid',                // Invalid request
}

export enum ApprovalPriority {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    URGENT = 'urgent',
    CRITICAL = 'critical'
}

export enum ApprovalAction {
    SUBMIT = 'submit',
    APPROVE = 'approve',
    REJECT = 'reject',
    SIGN = 'sign',
    REQUEST_INFO = 'request_info',
    WITHDRAW = 'withdraw',
    CANCEL = 'cancel',
    ESCALATE = 'escalate',
    DELEGATE = 'delegate',
    RETURN_FOR_REVISION = 'return_for_revision'
}

export enum SignatureType {
    ELECTRONIC = 'electronic',
    DIGITAL = 'digital',
    WET_SIGNATURE = 'wet_signature',
    BIOMETRIC = 'biometric'
}

export enum ApprovalFlow {
    SINGLE_APPROVER = 'single_approver',        // One person approves
    SEQUENTIAL = 'sequential',                   // Step-by-step approval chain
    PARALLEL = 'parallel',                       // Multiple people approve simultaneously
    MAJORITY = 'majority',                       // Majority vote required
    UNANIMOUS = 'unanimous',                     // All must approve
    CONDITIONAL = 'conditional',                 // Based on conditions (amount, type, etc.)
    ESCALATION = 'escalation'                   // Auto-escalate if not approved in time
}

export enum ApprovalDelegationType {
    TEMPORARY = 'temporary',                     // Time-limited delegation
    PERMANENT = 'permanent',                     // Permanent until changed
    CONDITIONAL = 'conditional',                 // Based on specific conditions
    EMERGENCY = 'emergency'                      // Emergency delegation
}

export enum NotificationFrequency {
    IMMEDIATE = 'immediate',
    DAILY = 'daily',
    WEEKLY = 'weekly',
    NEVER = 'never'
}

export enum EscalationTrigger {
    TIME_BASED = 'time_based',                   // After certain time period
    INACTIVITY = 'inactivity',                   // No action taken
    REJECTION_COUNT = 'rejection_count',         // Multiple rejections
    PRIORITY_BASED = 'priority_based',           // Based on priority level
    AMOUNT_BASED = 'amount_based',               // Based on monetary amount
    MANUAL = 'manual'                            // Manual escalation
} 