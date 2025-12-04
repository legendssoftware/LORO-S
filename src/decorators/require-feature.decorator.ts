import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'features';

type ModuleFeature =
    | `approvals.${string}`
    | `assets.${string}`
    | `claims.${string}`
    | `clients.${string}`
    | `communication.${string}`
    | `competitors.${string}`
    | `docs.${string}`
    | `journal.${string}`
    | `leads.${string}`
    | `leave.${string}`
    | `licensing.${string}`
    | `news.${string}`
    | `notifications.${string}`
    | `organisation.${string}`
    | `payslips.${string}`
    | `products.${string}`
    | `reports.${string}`
    | `resellers.${string}`
    | `rewards.${string}`
    | `shop.${string}`
    | `tasks.${string}`
    | `tracking.${string}`
    | `warnings.${string}`;

/**
 * Decorator to require specific features for accessing a route
 * @param features Array of required features in format 'module.feature'
 * Example: @RequireFeature('assets.advanced', 'reports.premium')
 */
export const RequireFeature = (...features: ModuleFeature[]) => SetMetadata(FEATURE_KEY, features); 