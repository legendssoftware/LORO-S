import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganisationSettings } from '../entities/organisation-settings.entity';
import { CreateOrganisationSettingsDto } from '../dto/create-organisation-settings.dto';
import { UpdateOrganisationSettingsDto } from '../dto/update-organisation-settings.dto';
import { Organisation } from '../entities/organisation.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

@Injectable()
export class OrganisationSettingsService {
    constructor(
        @InjectRepository(OrganisationSettings)
        private settingsRepository: Repository<OrganisationSettings>,
        @InjectRepository(Organisation)
        private organisationRepository: Repository<Organisation>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    private readonly CACHE_PREFIX = 'org_settings';
    private getSettingsCacheKey(orgRef: string): string {
        return `${this.CACHE_PREFIX}:${orgRef}`;
    }

    // Default cache TTL (in seconds)
    private readonly DEFAULT_CACHE_TTL = 3600; // 1 hour

    private async clearSettingsCache(orgRef: string): Promise<void> {
        await this.cacheManager.del(this.getSettingsCacheKey(orgRef));
    }

    async create(orgRef: string, dto: CreateOrganisationSettingsDto): Promise<{ settings: OrganisationSettings | null; message: string }> {
        try {
            const organisation = await this.organisationRepository.findOne({
                where: { ref: orgRef, isDeleted: false },
                relations: ['settings'],
            });

            if (!organisation) {
                return {
                    settings: null,
                    message: 'Organisation not found',
                };
            }

            if (organisation.settings) {
                return {
                    settings: null,
                    message: 'Settings already exist for this organisation',
                };
            }

            const organisationUid = organisation.clerkOrgId ?? organisation.ref;
            const settings = this.settingsRepository.create({
                ...dto,
                organisationUid,
            });

            const savedSettings = await this.settingsRepository.save(settings);
            
            await this.clearSettingsCache(orgRef);

            return {
                settings: savedSettings as OrganisationSettings,
                message: 'Settings created successfully',
            };
        } catch (error) {
            return {
                settings: null,
                message: error?.message || 'Error creating settings',
            };
        }
    }

    async findOne(orgRef: string): Promise<{ settings: OrganisationSettings | null; message: string }> {
        try {
            // Try to get from cache first
            const cacheKey = this.getSettingsCacheKey(orgRef);
            const cachedSettings = await this.cacheManager.get<OrganisationSettings>(cacheKey);
            
            if (cachedSettings) {
                return {
                    settings: cachedSettings,
                    message: 'Settings retrieved successfully',
                };
            }

            // If not in cache, fetch from database
            const settings = await this.settingsRepository.findOne({
                where: { organisation: { ref: orgRef }, isDeleted: false },
                relations: ['organisation'],
            });

            if (!settings) {
                return {
                    settings: null,
                    message: 'Settings not found',
                };
            }

            // Store in cache
            await this.cacheManager.set(cacheKey, settings, {
                ttl: this.DEFAULT_CACHE_TTL
            });

            return {
                settings,
                message: 'Settings retrieved successfully',
            };
        } catch (error) {
            return {
                settings: null,
                message: error?.message || 'Error retrieving settings',
            };
        }
    }

    async update(orgRef: string, dto: UpdateOrganisationSettingsDto): Promise<{ settings: OrganisationSettings | null; message: string }> {
        try {
            const { settings } = await this.findOne(orgRef);
            
            if (!settings) {
                return {
                    settings: null,
                    message: 'Settings not found',
                };
            }

            const updatedSettings = this.settingsRepository.merge(settings, dto);
            const savedSettings = await this.settingsRepository.save(updatedSettings);
            
            // Clear cache after updating
            await this.clearSettingsCache(orgRef);

            return {
                settings: savedSettings,
                message: 'Settings updated successfully',
            };
        } catch (error) {
            return {
                settings: null,
                message: error?.message || 'Error updating settings',
            };
        }
    }

    /** Get notification channel flags (push, email) for org by Clerk ID. */
    async getNotificationChannels(orgId?: string): Promise<{ push: boolean; email: boolean }> {
        const defaultChannels = { push: true, email: true };
        if (!orgId) return defaultChannels;
        try {
            const settings = await this.settingsRepository.findOne({
                where: { organisationUid: orgId },
                select: ['notifications'],
            });
            const notif = settings?.notifications;
            if (!notif || typeof notif !== 'object') return defaultChannels;
            return { push: notif.push !== false, email: notif.email !== false };
        } catch {
            return defaultChannels;
        }
    }

    async remove(orgRef: string): Promise<{ success: boolean; message: string }> {
        try {
            const { settings } = await this.findOne(orgRef);
            
            if (!settings) {
                return {
                    success: false,
                    message: 'Settings not found',
                };
            }

            await this.settingsRepository.update(settings.uid, { isDeleted: true });
            
            // Clear cache after removing
            await this.clearSettingsCache(orgRef);

            return {
                success: true,
                message: 'Settings removed successfully',
            };
        } catch (error) {
            return {
                success: false,
                message: error?.message || 'Error removing settings',
            };
        }
    }
} 