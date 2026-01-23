import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LicenseAudit } from '../entities/license-audit.entity';
import { User } from '../../user/entities/user.entity';
import { License } from '../entities/license.entity';
import { AuditAction, AuditMetadata } from './audit.types';

// Re-export the AuditAction enum so it can be imported from this file
export { AuditAction } from './audit.types';

@Injectable()
export class LicenseAuditService {
    private readonly logger = new Logger(LicenseAuditService.name);

    constructor(
        @InjectRepository(LicenseAudit)
        private readonly auditRepository: Repository<LicenseAudit>
    ) { }

    async log(
        action: AuditAction,
        license: License,
        user: User,
        metadata: AuditMetadata = {}
    ): Promise<LicenseAudit> {
        try {
            // Get organization uid from the relation if available, otherwise we need to query it
            let organizationId: number;
            if (license.organisation?.uid) {
                organizationId = license.organisation.uid;
            } else {
                // If organisation relation is not loaded, we can't get the uid
                // This should not happen in normal flow, but handle gracefully
                throw new Error('License organisation relation must be loaded to create audit log');
            }

            const audit = this.auditRepository.create({
                action,
                licenseId: license.uid,
                userId: user.uid,
                organizationId: organizationId,
                metadata: {
                    ...metadata,
                    timestamp: new Date().toISOString(),
                },
            });

            const saved = await this.auditRepository.save(audit);
            this.logger.log(
                `Audit log created for license ${license.uid}: ${action}`
            );
            return saved;
        } catch (error) {
            this.logger.error(
                `Failed to create audit log for license ${license.uid}`,
                error.stack
            );
            throw error;
        }
    }

    async getAuditTrail(
        licenseId: number,
        options: {
            startDate?: Date;
            endDate?: Date;
            actions?: AuditAction[];
            limit?: number;
            offset?: number;
        } = {}
    ): Promise<{ total: number; items: LicenseAudit[] }> {
        try {
            const query = this.auditRepository
                .createQueryBuilder('audit')
                .where('audit.licenseId = :licenseId', { licenseId });

            if (options.startDate) {
                query.andWhere('audit.createdAt >= :startDate', {
                    startDate: options.startDate,
                });
            }

            if (options.endDate) {
                query.andWhere('audit.createdAt <= :endDate', {
                    endDate: options.endDate,
                });
            }

            if (options.actions?.length) {
                query.andWhere('audit.action IN (:...actions)', {
                    actions: options.actions,
                });
            }

            const total = await query.getCount();

            query
                .orderBy('audit.createdAt', 'DESC')
                .skip(options.offset || 0)
                .take(options.limit || 50);

            const items = await query.getMany();

            return { total, items };
        } catch (error) {
            this.logger.error(
                `Failed to retrieve audit trail for license ${licenseId}`,
                error.stack
            );
            throw error;
        }
    }

    async getOrganizationAuditTrail(
        organizationId: number,
        options: {
            startDate?: Date;
            endDate?: Date;
            actions?: AuditAction[];
            limit?: number;
            offset?: number;
        } = {}
    ): Promise<{ total: number; items: LicenseAudit[] }> {
        try {
            const query = this.auditRepository
                .createQueryBuilder('audit')
                .where('audit.organizationId = :organizationId', {
                    organizationId,
                });

            if (options.startDate) {
                query.andWhere('audit.createdAt >= :startDate', {
                    startDate: options.startDate,
                });
            }

            if (options.endDate) {
                query.andWhere('audit.createdAt <= :endDate', {
                    endDate: options.endDate,
                });
            }

            if (options.actions?.length) {
                query.andWhere('audit.action IN (:...actions)', {
                    actions: options.actions,
                });
            }

            const total = await query.getCount();

            query
                .orderBy('audit.createdAt', 'DESC')
                .skip(options.offset || 0)
                .take(options.limit || 50);

            const items = await query.getMany();

            return { total, items };
        } catch (error) {
            this.logger.error(
                `Failed to retrieve organization audit trail for ${organizationId}`,
                error.stack
            );
            throw error;
        }
    }
} 