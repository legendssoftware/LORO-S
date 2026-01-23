import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { License } from '../entities/license.entity';
import { LicenseAuditService, AuditAction } from './audit.service';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailType } from '../../lib/enums/email.enums';
import { LicenseStatus } from '../../lib/enums/license.enums';

export interface TransferResult {
    success: boolean;
    message: string;
    license?: License;
    error?: string;
}

@Injectable()
export class LicenseTransferService {
    private readonly logger = new Logger(LicenseTransferService.name);

    constructor(
        @InjectRepository(License)
        private readonly licenseRepository: Repository<License>,
        @InjectRepository(Organisation)
        private readonly organisationRepository: Repository<Organisation>,
        private readonly auditService: LicenseAuditService,
        private readonly eventEmitter: EventEmitter2
    ) { }

    async transferLicense(
        licenseId: number,
        newOrganizationId: number,
        user: User,
        reason: string
    ): Promise<TransferResult> {
        try {
            const license = await this.licenseRepository.findOne({
                where: { uid: licenseId },
                relations: ['organisation'],
            });

            if (!license) {
                throw new BadRequestException('License not found');
            }

            // Fetch the new organization to get its ref/clerkOrgId
            const newOrganization = await this.organisationRepository.findOne({
                where: { uid: newOrganizationId },
            });

            if (!newOrganization) {
                throw new BadRequestException('New organization not found');
            }

            // Get the organisation ref (should match clerkOrgId)
            const newOrgRef = newOrganization.ref || newOrganization.clerkOrgId;
            if (!newOrgRef) {
                throw new BadRequestException('New organization does not have a ref or clerkOrgId');
            }

            // Compare using string values
            if (license.organisationRef === newOrgRef) {
                throw new BadRequestException(
                    'License already belongs to this organization'
                );
            }

            // Store old organization details for notification
            const oldOrganization = license.organisation;
            if (!oldOrganization) {
                throw new BadRequestException('License must have an associated organisation to transfer');
            }

            // Update license with new organization ref (string)
            license.organisationRef = newOrgRef;
            const updatedLicense = await this.licenseRepository.save(license);

            // Reload license with organisation relation for audit and notifications
            const licenseWithOrg = await this.licenseRepository.findOne({
                where: { uid: licenseId },
                relations: ['organisation'],
            });

            if (!licenseWithOrg || !licenseWithOrg.organisation) {
                throw new BadRequestException('Failed to load updated license with organisation');
            }

            // Create audit log (use the reloaded license with organisation relation)
            await this.auditService.log(AuditAction.TRANSFER, licenseWithOrg, user, {
                oldOrganizationId: oldOrganization.uid,
                newOrganizationId,
                reason,
            });

            // Notify both organizations
            await this.notifyOrganizations(
                oldOrganization,
                licenseWithOrg.organisation,
                licenseWithOrg,
                user
            );

            return {
                success: true,
                message: 'License transferred successfully',
                license: licenseWithOrg,
            };
        } catch (error) {
            this.logger.error(
                `Failed to transfer license ${licenseId}`,
                error.stack
            );
            return {
                success: false,
                message: 'Failed to transfer license',
                error: error.message,
            };
        }
    }

    private async notifyOrganizations(
        oldOrg: any,
        newOrg: any,
        license: License,
        user: User
    ): Promise<void> {
        const baseNotificationData = {
            licenseKey: license.licenseKey,
            transferredBy: user.name,
            transferDate: new Date().toISOString(),
        };

        // Notify old organization
        await this.eventEmitter.emit('send.email', EmailType.LICENSE_TRANSFERRED_FROM, [oldOrg.email], {
            ...baseNotificationData,
            organizationName: oldOrg.name,
            newOrganizationName: newOrg.name,
        });

        // Notify new organization
        await this.eventEmitter.emit('send.email', EmailType.LICENSE_TRANSFERRED_TO, [newOrg.email], {
            ...baseNotificationData,
            organizationName: newOrg.name,
            oldOrganizationName: oldOrg.name,
        });
    }

    async validateTransferEligibility(
        licenseId: number
    ): Promise<{ eligible: boolean; reason?: string }> {
        try {
            const license = await this.licenseRepository.findOne({
                where: { uid: licenseId },
            });

            if (!license) {
                return {
                    eligible: false,
                    reason: 'License not found',
                };
            }

            // Check if license is active
            if (license.status !== LicenseStatus.ACTIVE) {
                return {
                    eligible: false,
                    reason: 'License must be active to transfer',
                };
            }

            // Check if license has any pending payments
            if (license.hasPendingPayments) {
                return {
                    eligible: false,
                    reason: 'License has pending payments',
                };
            }

            // Add more validation rules as needed

            return { eligible: true };
        } catch (error) {
            this.logger.error(
                `Failed to validate transfer eligibility for license ${licenseId}`,
                error.stack
            );
            throw error;
        }
    }
} 