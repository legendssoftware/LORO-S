export enum ApprovalType {
    // 🧾 Document & Financial Approvals
    INVOICE = 'invoice',                      // Invoice approval for payment processing
    QUOTATION = 'quotation',                  // Sales quotation requiring approval
    CONTRACT = 'contract',                    // Contract agreement approval
    REPORT = 'report',                        // Business/financial report approval
    PROPOSAL = 'proposal',                    // Business proposal or plan approval
    POLICY = 'policy',                        // Company policy document approval
    BUDGET_REQUEST = 'budget_request',        // Budget allocation request
    PURCHASE_ORDER = 'purchase_order',        // Purchase order for goods/services

    // 👥 HR & Employee Approvals
    LEAVE_REQUEST = 'leave_request',          // Annual leave, sick leave, or other absence
    OVERTIME = 'overtime',                    // Overtime work request
    EXPENSE_CLAIM = 'expense_claim',          // Business expense reimbursement
    REIMBURSEMENT = 'reimbursement',          // Expense or travel reimbursement
    TRAVEL_REQUEST = 'travel_request',        // Business travel authorization
    ROLE_CHANGE = 'role_change',              // Job role or position change
    DEPARTMENT_TRANSFER = 'department_transfer', // Department transfer request
    SALARY_ADJUSTMENT = 'salary_adjustment',  // Salary increase or adjustment
    RECRUITMENT_REQUEST = 'recruitment_request', // New hire approval
    TRAINING_REQUEST = 'training_request',    // Employee training approval
    PERFORMANCE_REVIEW = 'performance_review', // Performance evaluation approval

    // 🏢 Operational & Administrative Approvals
    ASSET_ASSIGNMENT = 'asset_assignment',    // Company asset assignment
    ASSET_TRANSFER = 'asset_transfer',        // Asset transfer between employees
    FACILITY_REQUEST = 'facility_request',    // Office/facility related requests
    IT_REQUEST = 'it_request',                // IT equipment/software requests
    SECURITY_ACCESS = 'security_access',      // System or physical access approval
    VENDOR_REGISTRATION = 'vendor_registration', // New vendor/supplier approval

    // 👤 User & Access Management Approvals
    USER_ACCESS = 'user_access',              // User account access request
    PASSWORD_RESET = 'password_reset',        // Administrative password reset
    SYSTEM_ACCESS = 'system_access',          // Software system access approval
    DATA_ACCESS = 'data_access',              // Sensitive data access approval

    // 💼 Client & Sales Approvals
    CLIENT_REGISTRATION = 'client_registration', // New client registration
    DISCOUNT_REQUEST = 'discount_request',    // Sales discount approval
    CREDIT_LIMIT = 'credit_limit',            // Credit limit increase
    PAYMENT_TERMS = 'payment_terms',          // Payment terms modification
    PRICE_CHANGE = 'price_change',            // Product/service price change
    SALES_TARGET_ADJUSTMENT = 'sales_target_adjustment', // Sales target modification

    // ⚙️ System & Technical Approvals
    SYSTEM_CHANGE = 'system_change',          // System configuration change
    DATA_EXPORT = 'data_export',              // Data export request
    INTEGRATION_REQUEST = 'integration_request', // Third-party integration
    SOFTWARE_UPGRADE = 'software_upgrade',    // Software update approval
    INFRASTRUCTURE_CHANGE = 'infrastructure_change', // IT infrastructure change
    SECURITY_POLICY_CHANGE = 'security_policy_change', // Security policy modification

    // 🏥 Healthcare & Medical Approvals
    MEDICAL_LEAVE = 'medical_leave',          // Medical leave request
    INSURANCE_CLAIM = 'insurance_claim',      // Health/medical insurance claim
    MEDICAL_PROCEDURE = 'medical_procedure',  // Medical procedure approval

    // 🎓 Education & Training Approvals
    COURSE_APPROVAL = 'course_approval',      // Training course approval
    CERTIFICATION_REQUEST = 'certification_request', // Professional certification
    EDUCATION_LEAVE = 'education_leave',      // Study leave approval

    // 📋 Compliance & Legal Approvals
    COMPLIANCE_REPORT = 'compliance_report',  // Regulatory compliance report
    LEGAL_DOCUMENT = 'legal_document',        // Legal document approval
    AUDIT_REQUEST = 'audit_request',          // Internal/external audit approval
    RISK_ASSESSMENT = 'risk_assessment',      // Risk assessment approval

    // 🎯 Project & Initiative Approvals
    PROJECT_INITIATION = 'project_initiation', // New project approval
    PROJECT_CHANGE = 'project_change',        // Project scope/time/budget change
    INITIATIVE_REQUEST = 'initiative_request', // Business initiative approval

    // 🏦 Financial & Banking Approvals
    LOAN_REQUEST = 'loan_request',            // Loan application approval
    INVESTMENT_REQUEST = 'investment_request', // Investment proposal approval
    FINANCIAL_REPORT = 'financial_report',    // Financial statement approval
    TAX_FILING = 'tax_filing',               // Tax document approval

    // 🏗️ Construction & Facilities Approvals
    CONSTRUCTION_REQUEST = 'construction_request', // Construction/modification
    MAINTENANCE_REQUEST = 'maintenance_request', // Facility maintenance approval
    SPACE_ALLOCATION = 'space_allocation',    // Office space allocation

    // 📦 Supply Chain & Procurement Approvals
    SUPPLIER_EVALUATION = 'supplier_evaluation', // Supplier assessment approval
    INVENTORY_ADJUSTMENT = 'inventory_adjustment', // Inventory level changes
    QUALITY_CONTROL = 'quality_control',      // Quality control approval

    // 🎨 Marketing & Creative Approvals
    MARKETING_CAMPAIGN = 'marketing_campaign', // Marketing campaign approval
    BRAND_APPROVAL = 'brand_approval',        // Brand usage/guideline approval
    CONTENT_APPROVAL = 'content_approval',    // Marketing content approval

    // 📊 Research & Development Approvals
    RESEARCH_PROJECT = 'research_project',    // R&D project approval
    PRODUCT_DEVELOPMENT = 'product_development', // New product development
    INNOVATION_REQUEST = 'innovation_request', // Innovation proposal approval

    // 🌍 Environmental & Sustainability Approvals
    ENVIRONMENTAL_IMPACT = 'environmental_impact', // Environmental assessment
    SUSTAINABILITY_INITIATIVE = 'sustainability_initiative', // Green initiative approval
    WASTE_MANAGEMENT = 'waste_management',    // Waste disposal approval

    // 🎪 Event & Entertainment Approvals
    EVENT_REQUEST = 'event_request',          // Company event approval
    ENTERTAINMENT_REQUEST = 'entertainment_request', // Client entertainment approval
    SPONSORSHIP_REQUEST = 'sponsorship_request', // Sponsorship approval

    // 🏆 Awards & Recognition Approvals
    AWARD_NOMINATION = 'award_nomination',    // Employee award nomination
    RECOGNITION_REQUEST = 'recognition_request', // Employee recognition approval

    // 🔒 Emergency & Security Approvals
    EMERGENCY_PROCEDURE = 'emergency_procedure', // Emergency response approval
    SECURITY_INCIDENT = 'security_incident',   // Security incident report
    CRISIS_MANAGEMENT = 'crisis_management',   // Crisis response approval

    // 📝 General & Miscellaneous Approvals
    GENERAL = 'general',                      // General purpose approval
    OTHER = 'other'                          // Other unspecified approval types
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