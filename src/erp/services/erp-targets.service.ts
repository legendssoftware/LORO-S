import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganisationSettings } from '../../organisation/entities/organisation-settings.entity';

/**
 * ERP Targets Service
 * 
 * Provides revenue target calculation logic for performance tracking.
 * Supports multiple target calculation methods: fixed, dynamic, historical.
 */
@Injectable()
export class ErpTargetsService {
	private readonly logger = new Logger(ErpTargetsService.name);

	// Default targets (in organization currency)
	private readonly DEFAULT_DAILY_TARGET = 1000000; // R1M per day
	private readonly DEFAULT_WEEKLY_TARGET = 3500000; // R3.5M per week
	private readonly DEFAULT_MONTHLY_TARGET = 15000000; // R15M per month
	private readonly DEFAULT_YEARLY_TARGET = 180000000; // R180M per year

	constructor(
		@InjectRepository(OrganisationSettings)
		private orgSettingsRepo: Repository<OrganisationSettings>,
	) {}

	/**
	 * Get daily revenue target for an organization
	 * 
	 * @param organisationUid - Organization unique identifier
	 * @returns Daily revenue target in organization currency
	 */
	async getDailyRevenueTarget(organisationUid: number): Promise<number> {
		try {
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid },
			});

			// Return configured target or default
			const target = settings?.performance?.dailyRevenueTarget ?? this.DEFAULT_DAILY_TARGET;
			
			this.logger.log(`Daily revenue target for org ${organisationUid}: ${target}`);
			return target;
		} catch (error) {
			this.logger.warn(`Error fetching daily target for org ${organisationUid}, using default: ${error.message}`);
			return this.DEFAULT_DAILY_TARGET;
		}
	}

	/**
	 * Get weekly revenue target for an organization
	 * 
	 * @param organisationUid - Organization unique identifier
	 * @returns Weekly revenue target in organization currency
	 */
	async getWeeklyRevenueTarget(organisationUid: number): Promise<number> {
		try {
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid },
			});

			const target = settings?.performance?.weeklyRevenueTarget ?? this.DEFAULT_WEEKLY_TARGET;
			
			this.logger.log(`Weekly revenue target for org ${organisationUid}: ${target}`);
			return target;
		} catch (error) {
			this.logger.warn(`Error fetching weekly target for org ${organisationUid}, using default: ${error.message}`);
			return this.DEFAULT_WEEKLY_TARGET;
		}
	}

	/**
	 * Get monthly revenue target for an organization
	 * 
	 * @param organisationUid - Organization unique identifier
	 * @returns Monthly revenue target in organization currency
	 */
	async getMonthlyRevenueTarget(organisationUid: number): Promise<number> {
		try {
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid },
			});

			const target = settings?.performance?.monthlyRevenueTarget ?? this.DEFAULT_MONTHLY_TARGET;
			
			this.logger.log(`Monthly revenue target for org ${organisationUid}: ${target}`);
			return target;
		} catch (error) {
			this.logger.warn(`Error fetching monthly target for org ${organisationUid}, using default: ${error.message}`);
			return this.DEFAULT_MONTHLY_TARGET;
		}
	}

	/**
	 * Get yearly revenue target for an organization
	 * 
	 * @param organisationUid - Organization unique identifier
	 * @returns Yearly revenue target in organization currency
	 */
	async getYearlyRevenueTarget(organisationUid: number): Promise<number> {
		try {
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid },
			});

			const target = settings?.performance?.yearlyRevenueTarget ?? this.DEFAULT_YEARLY_TARGET;
			
			this.logger.log(`Yearly revenue target for org ${organisationUid}: ${target}`);
			return target;
		} catch (error) {
			this.logger.warn(`Error fetching yearly target for org ${organisationUid}, using default: ${error.message}`);
			return this.DEFAULT_YEARLY_TARGET;
		}
	}

	/**
	 * Get revenue target for a specific date range
	 * 
	 * @param organisationUid - Organization unique identifier
	 * @param startDate - Start date of the range
	 * @param endDate - End date of the range
	 * @returns Total revenue target for the date range
	 */
	async getRevenueTargetForDateRange(
		organisationUid: number,
		startDate: string,
		endDate: string,
	): Promise<number> {
		try {
			const start = new Date(startDate);
			const end = new Date(endDate);
			
			// Calculate number of days in range
			const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
			
			this.logger.log(`Calculating target for ${daysDiff} days (${startDate} to ${endDate})`);
			
			// Get daily target and multiply by days
			const dailyTarget = await this.getDailyRevenueTarget(organisationUid);
			const totalTarget = dailyTarget * daysDiff;
			
			this.logger.log(`Total target for date range: ${totalTarget} (${daysDiff} x ${dailyTarget})`);
			
			return totalTarget;
		} catch (error) {
			this.logger.error(`Error calculating target for date range: ${error.message}`);
			// Return default daily target as fallback
			return this.DEFAULT_DAILY_TARGET;
		}
	}

	/**
	 * Get performance settings for an organization
	 * 
	 * @param organisationUid - Organization unique identifier
	 * @returns Performance settings with defaults applied
	 */
	async getPerformanceSettings(organisationUid: number) {
		try {
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid },
			});

			const performanceSettings = settings?.performance || {};

			return {
				dailyRevenueTarget: performanceSettings.dailyRevenueTarget ?? this.DEFAULT_DAILY_TARGET,
				weeklyRevenueTarget: performanceSettings.weeklyRevenueTarget ?? this.DEFAULT_WEEKLY_TARGET,
				monthlyRevenueTarget: performanceSettings.monthlyRevenueTarget ?? this.DEFAULT_MONTHLY_TARGET,
				yearlyRevenueTarget: performanceSettings.yearlyRevenueTarget ?? this.DEFAULT_YEARLY_TARGET,
				targetCalculationMethod: performanceSettings.targetCalculationMethod ?? 'fixed',
				historicalPeriodDays: performanceSettings.historicalPeriodDays ?? 30,
				growthTargetPercentage: performanceSettings.growthTargetPercentage ?? 20,
			};
		} catch (error) {
			this.logger.error(`Error fetching performance settings for org ${organisationUid}: ${error.message}`);
			
			// Return defaults on error
			return {
				dailyRevenueTarget: this.DEFAULT_DAILY_TARGET,
				weeklyRevenueTarget: this.DEFAULT_WEEKLY_TARGET,
				monthlyRevenueTarget: this.DEFAULT_MONTHLY_TARGET,
				yearlyRevenueTarget: this.DEFAULT_YEARLY_TARGET,
				targetCalculationMethod: 'fixed' as const,
				historicalPeriodDays: 30,
				growthTargetPercentage: 20,
			};
		}
	}

	/**
	 * Update performance settings for an organization
	 * 
	 * @param organisationUid - Organization unique identifier
	 * @param performance - Performance settings to update
	 */
	async updatePerformanceSettings(
		organisationUid: number,
		performance: {
			dailyRevenueTarget?: number;
			weeklyRevenueTarget?: number;
			monthlyRevenueTarget?: number;
			yearlyRevenueTarget?: number;
			targetCalculationMethod?: 'fixed' | 'dynamic' | 'historical';
			historicalPeriodDays?: number;
			growthTargetPercentage?: number;
		},
	): Promise<void> {
		try {
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid },
			});

			if (!settings) {
				this.logger.error(`Organization settings not found for org ${organisationUid}`);
				throw new Error('Organization settings not found');
			}

			// Merge new performance settings with existing ones
			const updatedPerformance = {
				...settings.performance,
				...performance,
			};

			// Update settings
			await this.orgSettingsRepo.update(
				{ organisationUid },
				{ performance: updatedPerformance },
			);

			this.logger.log(`Performance settings updated for org ${organisationUid}`);
		} catch (error) {
			this.logger.error(`Error updating performance settings for org ${organisationUid}: ${error.message}`);
			throw error;
		}
	}
}

