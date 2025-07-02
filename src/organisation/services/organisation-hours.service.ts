import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganisationHours } from '../entities/organisation-hours.entity';
import { CreateOrganisationHoursDto } from '../dto/create-organisation-hours.dto';
import { UpdateOrganisationHoursDto } from '../dto/update-organisation-hours.dto';
import { Organisation } from '../entities/organisation.entity';
import { v4 as uuidv4 } from 'uuid';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

@Injectable()
export class OrganisationHoursService {
    constructor(
        @InjectRepository(OrganisationHours)
        private hoursRepository: Repository<OrganisationHours>,
        @InjectRepository(Organisation)
        private organisationRepository: Repository<Organisation>,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    private readonly CACHE_PREFIX = 'org_hours';
    private getHoursAllCacheKey(orgRef: string): string {
        return `${this.CACHE_PREFIX}:all:${orgRef}`;
    }
    private getHoursOneCacheKey(orgRef: string, hoursRef: string): string {
        return `${this.CACHE_PREFIX}:${orgRef}:${hoursRef}`;
    }

    // Default cache TTL (in seconds)
    private readonly DEFAULT_CACHE_TTL = 3600; // 1 hour

    private async clearHoursCache(orgRef: string, hoursRef?: string): Promise<void> {
        // Always clear the "all hours" cache for this org
        await this.cacheManager.del(this.getHoursAllCacheKey(orgRef));
        
        // If a specific hours ref is provided, clear that cache too
        if (hoursRef) {
            await this.cacheManager.del(this.getHoursOneCacheKey(orgRef, hoursRef));
        }
    }

    async create(orgRef: string, dto: CreateOrganisationHoursDto): Promise<OrganisationHours> {
        const organisation = await this.organisationRepository.findOne({
            where: { ref: orgRef, isDeleted: false },
        });

        if (!organisation) {
            throw new NotFoundException('Organisation not found');
        }

        const hours = this.hoursRepository.create({
            ...dto,
            ref: uuidv4(),
            organisation,
        });

        const savedHours = await this.hoursRepository.save(hours);
        
        // Clear cache after creating
        await this.clearHoursCache(orgRef);
        
        return savedHours;
    }

    async findAll(orgRef: string): Promise<OrganisationHours[]> {
        // Try to get from cache first
        const cacheKey = this.getHoursAllCacheKey(orgRef);
        const cachedHours = await this.cacheManager.get<OrganisationHours[]>(cacheKey);
        
        if (cachedHours) {
            return cachedHours;
        }

        // If not in cache, fetch from database
        const hours = await this.hoursRepository.find({
            where: { organisation: { ref: orgRef }, isDeleted: false },
            relations: ['organisation'],
        });

        // Store in cache
        await this.cacheManager.set(cacheKey, hours, {
            ttl: this.DEFAULT_CACHE_TTL
        });

        return hours;
    }

    async findDefault(orgRef: string): Promise<OrganisationHours | null> {
        // Try to get from cache first
        const cacheKey = `${this.CACHE_PREFIX}:default:${orgRef}`;
        const cachedHours = await this.cacheManager.get<OrganisationHours>(cacheKey);
        
        if (cachedHours) {
            return cachedHours;
        }

        // If not in cache, fetch from database - get the first/default hours for the organization
        const hours = await this.hoursRepository.findOne({
            where: { organisation: { ref: orgRef }, isDeleted: false },
            relations: ['organisation'],
            order: { createdAt: 'ASC' }, // Get the first created (default) hours
        });

        if (hours) {
            // Store in cache
            await this.cacheManager.set(cacheKey, hours, {
                ttl: this.DEFAULT_CACHE_TTL
            });
        }

        return hours;
    }

    async findOne(orgRef: string, hoursRef: string): Promise<OrganisationHours> {
        // Try to get from cache first
        const cacheKey = this.getHoursOneCacheKey(orgRef, hoursRef);
        const cachedHours = await this.cacheManager.get<OrganisationHours>(cacheKey);
        
        if (cachedHours) {
            return cachedHours;
        }

        // If not in cache, fetch from database
        const hours = await this.hoursRepository.findOne({
            where: { ref: hoursRef, organisation: { ref: orgRef }, isDeleted: false },
            relations: ['organisation'],
        });

        if (!hours) {
            throw new NotFoundException('Hours not found');
        }

        // Store in cache
        await this.cacheManager.set(cacheKey, hours, {
            ttl: this.DEFAULT_CACHE_TTL
        });

        return hours;
    }

    async update(orgRef: string, hoursRef: string, dto: UpdateOrganisationHoursDto): Promise<OrganisationHours> {
        const hours = await this.findOne(orgRef, hoursRef);
        
        const updatedHours = this.hoursRepository.merge(hours, dto);
        const savedHours = await this.hoursRepository.save(updatedHours);
        
        // Clear cache after updating
        await this.clearHoursCache(orgRef, hoursRef);
        
        return savedHours;
    }

    async updateDefault(orgRef: string, dto: UpdateOrganisationHoursDto): Promise<OrganisationHours> {
        const organisation = await this.organisationRepository.findOne({
            where: { ref: orgRef, isDeleted: false },
        });

        if (!organisation) {
            throw new NotFoundException('Organisation not found');
        }

        // Check if default hours already exist for this organization
        let existingHours = await this.hoursRepository.findOne({
            where: { organisation: { ref: orgRef }, isDeleted: false },
            relations: ['organisation'],
        });

        if (existingHours) {
            // Update existing hours
            const updatedHours = this.hoursRepository.merge(existingHours, dto);
            const savedHours = await this.hoursRepository.save(updatedHours);
            
            // Clear cache after updating
            await this.clearHoursCache(orgRef, existingHours.ref);
            
            return savedHours;
        } else {
            // Create new default hours if none exist
            const hours = this.hoursRepository.create({
                ...dto,
                ref: uuidv4(),
                organisation,
            });

            const savedHours = await this.hoursRepository.save(hours);
            
            // Clear cache after creating
            await this.clearHoursCache(orgRef);
            
            return savedHours;
        }
    }

    async remove(orgRef: string, hoursRef: string): Promise<void> {
        const hours = await this.findOne(orgRef, hoursRef);
        await this.hoursRepository.update(hours.ref, { isDeleted: true });
        
        // Clear cache after removing
        await this.clearHoursCache(orgRef, hoursRef);
    }
} 