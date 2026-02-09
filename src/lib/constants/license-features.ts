import { SubscriptionPlan } from '../enums/license.enums';

// Temporary constant for enforcing enterprise-only access
export const ENTERPRISE_ONLY_FEATURES = {
    // Approvals
    'approvals.access': true,
    // Assets
    'assets.access': true,
    // Claims
    'claims.access': true,
    // Clients
    'clients.access': true,
    // Communication
    'communication.access': true,
    // Docs
    'docs.access': true,
    // Journal
    'journal.access': true,
    // Leads
    'leads.access': true,
    // Leave
    'leave.access': true,
    // Licensing
    'licensing.access': true,
    // News
    'news.access': true,
    // Notifications
    'notifications.access': true,
    // Organisation
    'organisation.access': true,
    // Products
    'products.access': true,
    // Reports
    'reports.access': true,
    // Resellers
    'resellers.access': true,
    // Rewards
    'rewards.access': true,
    // Shop
    'shop.access': true,
    // Tasks
    'tasks.access': true,
    // Tracking
    'tracking.access': true,
    // Users
    'users.access': true,
    // Warnings
    'warnings.access': true,
    // Payslips
    'payslips.access': true,
    // Client Portal: allows org's clients (client role) to access the app (products, shop, quotations)
    'client.portal.access': true,
};

const STARTER_FEATURES = {
    // Core CRM Functionality
    'leads.basic': true,
    'clients.basic': true,
    'tasks.basic': true,
    'shop.basic': true,
    'quotations.basic': true,
    'inventory.single_location': true,
    'reports.basic': true,
    'mobile.basic': true,
    'support.email': true,
    // Platform Access (HR, SALES, CRM, ALL)
    'platform.hr': true,
    'platform.sales': true,
    'platform.crm': true,
    'platform.all': true,
    // Basic Views
    'assets.view': true,
    'claims.view': true,
    'journal.view': true,
    'products.view': true,
    'news.view': true,
    'notifications.basic': true,
    'organisation.basic': true,
    'users.basic': true,
    // Payslips
    'payslips.basic': true,
    // Approvals
    'approvals.basic': true,
};

const PROFESSIONAL_FEATURES = {
    ...STARTER_FEATURES,
    // Field Operations & Analysis
    'leads.advanced': true,
    'clients.advanced': true,
    'tasks.advanced': true,
    'claims.management': true,
    'competitor.analysis': true,
    'tracking.mapping': true,
    'geofencing.basic': true,
    'route.optimization': true,
    'shop.advanced': true,
    'quotations.advanced': true,
    'inventory.multi_location': true,
    'reports.advanced': true,
    'mobile.offline': true,
    'support.priority': true,
    // Platform Access - Professional
    'platform.all': true,
    // Enhanced Operations
    'assets.advanced': true,
    'journal.advanced': true,
    'products.advanced': true,
    'communication.advanced': true,
    'notifications.advanced': true,
    'organisation.advanced': true,
    'users.advanced': true,
    // Payslips
    'payslips.advanced': true,
    // Approvals
    'approvals.advanced': true,
};

const BUSINESS_FEATURES = {
    ...PROFESSIONAL_FEATURES,
    // Complete Business Ecosystem
    'tracking.unlimited': true,
    'geofencing.unlimited': true,
    'route.advanced_optimization': true,
    'branches.multi_management': true,
    'assets.tracking': true,
    'rewards.gamification': true,
    'feedback.advanced': true,
    'news.announcements': true,
    'resellers.management': true,
    'api.access': true,
    'integrations.custom': true,
    'support.technical_priority': true,
    'support.dedicated_manager': true,
    'branding.white_label': true,
    'analytics.predictive': true,
    // Platform Access - Business
    'platform.all': true,
    // Premium Features
    'claims.premium': true,
    'clients.premium': true,
    'communication.premium': true,
    'docs.premium': true,
    'journal.premium': true,
    'leads.premium': true,
    'leads.access': true, // Required for EnterpriseOnly('leads') decorator
    'products.premium': true,
    'reports.premium': true,
    'shop.premium': true,
    'tasks.premium': true,
    'users.premium': true,
    'payslips.premium': true,
    'approvals.premium': true,
};

const ENTERPRISE_FEATURES = {
    ...BUSINESS_FEATURES,
    ...ENTERPRISE_ONLY_FEATURES,
    // Platform Access - Enterprise
    'platform.all': true,
    // Enterprise Features
    'assets.enterprise': true,
    'claims.enterprise': true,
    'clients.enterprise': true,
    'communication.enterprise': true,
    'docs.enterprise': true,
    'journal.enterprise': true,
    'leads.enterprise': true,
    'licensing.manage': true,
    'news.enterprise': true,
    'notifications.enterprise': true,
    'organisation.enterprise': true,
    'products.enterprise': true,
    'reports.enterprise': true,
    'resellers.enterprise': true,
    'rewards.enterprise': true,
    'shop.enterprise': true,
    'tasks.enterprise': true,
    'tracking.enterprise': true,
    'users.enterprise': true,
    'payslips.enterprise': true,
    'approvals.enterprise': true,
};

export const PLAN_FEATURES = {
    [SubscriptionPlan.STARTER]: STARTER_FEATURES,
    [SubscriptionPlan.PROFESSIONAL]: PROFESSIONAL_FEATURES,
    [SubscriptionPlan.BUSINESS]: BUSINESS_FEATURES,
    [SubscriptionPlan.ENTERPRISE]: ENTERPRISE_FEATURES,
}; 