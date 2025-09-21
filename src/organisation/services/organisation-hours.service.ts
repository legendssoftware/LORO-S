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

    /**
     * Check if organization is currently open based on hours configuration
     * @param orgRef - Organization reference
     * @param checkTime - Time to check (defaults to current time)
     * @returns Object with organization status information
     */
    async isOrganizationOpen(orgRef: string, checkTime: Date = new Date()): Promise<{
        isOpen: boolean;
        isWorkingDay: boolean;
        isHolidayMode: boolean;
        reason?: string;
        scheduledOpen?: string;
        scheduledClose?: string;
        dayOfWeek: string;
    }> {
        try {
            const hours = await this.findDefault(orgRef);
            
            if (!hours) {
                return {
                    isOpen: true, // Default to open if no hours configured
                    isWorkingDay: true,
                    isHolidayMode: false,
                    reason: 'No operating hours configured',
                    dayOfWeek: this.getDayOfWeek(checkTime),
                };
            }

            const dayOfWeek = this.getDayOfWeek(checkTime);
            const currentTime = this.formatTime(checkTime);

            // Check holiday mode first
            if (hours.holidayMode) {
                const isStillHoliday = hours.holidayUntil ? checkTime <= hours.holidayUntil : true;
                if (isStillHoliday) {
                    return {
                        isOpen: false,
                        isWorkingDay: false,
                        isHolidayMode: true,
                        reason: `Organization is in holiday mode${hours.holidayUntil ? ` until ${hours.holidayUntil.toDateString()}` : ''}`,
                        dayOfWeek,
                    };
                }
            }

            // Check detailed schedule first (if available)
            if (hours.schedule) {
                const daySchedule = hours.schedule[dayOfWeek.toLowerCase() as keyof typeof hours.schedule];
                if (daySchedule?.closed) {
                    return {
                        isOpen: false,
                        isWorkingDay: false,
                        isHolidayMode: false,
                        reason: `Organization is closed on ${dayOfWeek}s`,
                        dayOfWeek,
                    };
                }

                if (daySchedule) {
                    const isWithinHours = this.isTimeWithinRange(
                        currentTime,
                        daySchedule.start,
                        daySchedule.end
                    );

                    return {
                        isOpen: isWithinHours,
                        isWorkingDay: true,
                        isHolidayMode: false,
                        reason: isWithinHours 
                            ? 'Within operating hours' 
                            : `Outside operating hours (${daySchedule.start} - ${daySchedule.end})`,
                        scheduledOpen: daySchedule.start,
                        scheduledClose: daySchedule.end,
                        dayOfWeek,
                    };
                }
            }

            // Fall back to weeklySchedule and default times
            const isWorkingDay = hours.weeklySchedule[dayOfWeek.toLowerCase() as keyof typeof hours.weeklySchedule];
            
            if (!isWorkingDay) {
                return {
                    isOpen: false,
                    isWorkingDay: false,
                    isHolidayMode: false,
                    reason: `Organization is closed on ${dayOfWeek}s`,
                    dayOfWeek,
                };
            }

            // Check if within operating hours
            const isWithinHours = this.isTimeWithinRange(
                currentTime,
                hours.openTime,
                hours.closeTime
            );

            return {
                isOpen: isWithinHours,
                isWorkingDay: true,
                isHolidayMode: false,
                reason: isWithinHours 
                    ? 'Within operating hours' 
                    : `Outside operating hours (${hours.openTime} - ${hours.closeTime})`,
                scheduledOpen: hours.openTime,
                scheduledClose: hours.closeTime,
                dayOfWeek,
            };

        } catch (error) {
            // If there's any error, default to open to avoid blocking legitimate check-ins
            return {
                isOpen: true,
                isWorkingDay: true,
                isHolidayMode: false,
                reason: `Error checking organization hours: ${error.message}`,
                dayOfWeek: this.getDayOfWeek(checkTime),
            };
        }
    }

    /**
     * Get day of week from date
     */
    private getDayOfWeek(date: Date): string {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        return days[date.getDay()];
    }

    /**
     * Format time as HH:mm from Date object
     */
    private formatTime(date: Date): string {
        return date.toTimeString().slice(0, 5);
    }

    /**
     * Check if time is within range (handles overnight periods)
     */
    private isTimeWithinRange(checkTime: string, startTime: string, endTime: string): boolean {
        const check = this.timeToMinutes(checkTime);
        const start = this.timeToMinutes(startTime);
        const end = this.timeToMinutes(endTime);

        if (start <= end) {
            // Same day range (e.g., 09:00 - 17:00)
            return check >= start && check <= end;
        } else {
            // Overnight range (e.g., 22:00 - 06:00)
            return check >= start || check <= end;
        }
    }

    /**
     * Convert time string to minutes since midnight
     */
    private timeToMinutes(time: string): number {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    }
} 