import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicensingService } from './licensing.service';
import { License } from './entities/license.entity';
import { LicenseStatus } from '../lib/enums/license.enums';

@Injectable()
export class LicensingNotificationsService {
    private readonly logger = new Logger(LicensingNotificationsService.name);
    private readonly NOTIFICATION_THRESHOLDS = [90, 60, 30, 15, 7];

    constructor(
        private readonly licensingService: LicensingService,
        // Inject your notification service here
        // private readonly notificationService: NotificationService,
    ) { }

    private async sendExpirationNotification(license: License, daysRemaining: number) {
        const message = this.getExpirationMessage(license, daysRemaining);
        this.logger.log(`Sending expiration notification for license ${license.licenseKey}: ${daysRemaining} days remaining`);

        // TODO: Implement actual notification sending
        // await this.notificationService.send({
        //     to: license.organisation.email,
        //     subject: `License Expiration Notice - ${daysRemaining} Days Remaining`,
        //     message,
        // });
    }

    private getExpirationMessage(license: License, daysRemaining: number): string {
        if (daysRemaining <= 0) {
            return `Your license ${license.licenseKey} has expired. Please renew immediately to avoid service interruption.`;
        }

        if (daysRemaining <= 7) {
            return `URGENT: Your license ${license.licenseKey} will expire in ${daysRemaining} days. Please renew now to avoid service interruption.`;
        }

        if (daysRemaining <= 15) {
            return `Important: Your license ${license.licenseKey} will expire in ${daysRemaining} days. Please renew soon.`;
        }

        return `Your license ${license.licenseKey} will expire in ${daysRemaining} days. Consider renewing to ensure uninterrupted service.`;
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async checkExpiringLicenses() {
        this.logger.log('Checking for expiring licenses...');

        for (const threshold of this.NOTIFICATION_THRESHOLDS) {
            const expiringLicenses = await this.licensingService.findExpiringLicenses(threshold);

            for (const license of expiringLicenses) {
                // Skip licenses without expiry date (perpetual licenses)
                if (!license.validUntil) {
                    continue;
                }
                const daysRemaining = Math.ceil((license.validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                await this.sendExpirationNotification(license, daysRemaining);
            }
        }
    }

    @Cron(CronExpression.EVERY_HOUR)
    async checkGracePeriodLicenses() {
        this.logger.log('Checking grace period licenses...');

        const licenses = await this.licensingService.findAll();
        const gracePeriodLicenses = licenses.filter(license => license.status === LicenseStatus.GRACE_PERIOD);

        for (const license of gracePeriodLicenses) {
            // Skip licenses without expiry date (perpetual licenses shouldn't be in grace period)
            if (!license.validUntil) {
                continue;
            }
            const daysRemaining = Math.ceil((license.validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            if (daysRemaining <= 0) {
                await this.licensingService.update(String(license.uid), { status: LicenseStatus.EXPIRED });
                await this.sendExpirationNotification(license, 0);
            }
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_NOON)
    async checkLicenseUsage() {
        this.logger.log('Checking license usage...');

        const licenses = await this.licensingService.findAll();

        for (const license of licenses) {
            if (license.status !== LicenseStatus.ACTIVE) continue;

            // TODO: Implement usage checking logic
            // const currentStorage = await this.storageService.getCurrentUsage(license.organisationRef);
            // const currentUsers = await this.userService.getCurrentCount(license.organisationRef);
            // const currentBranches = await this.branchService.getCurrentCount(license.organisationRef);

            // if (currentStorage > license.storageLimit) {
            //     await this.sendUsageWarning(license, 'storage', currentStorage, license.storageLimit);
            // }
            // if (currentUsers > license.maxUsers) {
            //     await this.sendUsageWarning(license, 'users', currentUsers, license.maxUsers);
            // }
            // if (currentBranches > license.maxBranches) {
            //     await this.sendUsageWarning(license, 'branches', currentBranches, license.maxBranches);
            // }
        }
    }
} 