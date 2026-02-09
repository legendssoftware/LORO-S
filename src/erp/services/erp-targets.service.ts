import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganisationSettings } from '../../organisation/entities/organisation-settings.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';

/**
 * ERP Targets Service
 * 
 * Provides revenue target calculation logic for performance tracking.
 * OrganisationSettings.organisationUid is Clerk ID (string); numeric uid is resolved internally.
 */
@Injectable()
export class ErpTargetsService {
	private readonly logger = new Logger(ErpTargetsService.name);

	private readonly DEFAULT_DAILY_TARGET = 1000000;
	private readonly DEFAULT_WEEKLY_TARGET = 3500000;
	private readonly DEFAULT_MONTHLY_TARGET = 15000000;
	private readonly DEFAULT_YEARLY_TARGET = 180000000;

	constructor(
		@InjectRepository(OrganisationSettings)
		private orgSettingsRepo: Repository<OrganisationSettings>,
		@InjectRepository(Organisation)
		private organisationRepo: Repository<Organisation>,
	) {}

	/** Resolve numeric uid to Clerk ID string for OrganisationSettings.organisationUid */
	private async toClerkId(organisationUid: number | string): Promise<string | null> {
		if (typeof organisationUid === 'string') return organisationUid;
		const org = await this.organisationRepo.findOne({
			where: { uid: organisationUid, isDeleted: false },
			select: ['clerkOrgId', 'ref'],
		});
		return org ? (org.clerkOrgId ?? org.ref) : null;
	}

	async getDailyRevenueTarget(organisationUid: number | string): Promise<number> {
		try {
			const clerkId = await this.toClerkId(organisationUid);
			if (!clerkId) return this.DEFAULT_DAILY_TARGET;
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid: clerkId },
			});
			const target = settings?.performance?.dailyRevenueTarget ?? this.DEFAULT_DAILY_TARGET;
			this.logger.log(`Daily revenue target for org ${organisationUid}: ${target}`);
			return target;
		} catch (error) {
			this.logger.warn(`Error fetching daily target for org ${organisationUid}, using default: ${error.message}`);
			return this.DEFAULT_DAILY_TARGET;
		}
	}

	async getWeeklyRevenueTarget(organisationUid: number | string): Promise<number> {
		try {
			const clerkId = await this.toClerkId(organisationUid);
			if (!clerkId) return this.DEFAULT_WEEKLY_TARGET;
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid: clerkId },
			});
			const target = settings?.performance?.weeklyRevenueTarget ?? this.DEFAULT_WEEKLY_TARGET;
			this.logger.log(`Weekly revenue target for org ${organisationUid}: ${target}`);
			return target;
		} catch (error) {
			this.logger.warn(`Error fetching weekly target for org ${organisationUid}, using default: ${error.message}`);
			return this.DEFAULT_WEEKLY_TARGET;
		}
	}

	async getMonthlyRevenueTarget(organisationUid: number | string): Promise<number> {
		try {
			const clerkId = await this.toClerkId(organisationUid);
			if (!clerkId) return this.DEFAULT_MONTHLY_TARGET;
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid: clerkId },
			});
			const target = settings?.performance?.monthlyRevenueTarget ?? this.DEFAULT_MONTHLY_TARGET;
			this.logger.log(`Monthly revenue target for org ${organisationUid}: ${target}`);
			return target;
		} catch (error) {
			this.logger.warn(`Error fetching monthly target for org ${organisationUid}, using default: ${error.message}`);
			return this.DEFAULT_MONTHLY_TARGET;
		}
	}

	async getYearlyRevenueTarget(organisationUid: number | string): Promise<number> {
		try {
			const clerkId = await this.toClerkId(organisationUid);
			if (!clerkId) return this.DEFAULT_YEARLY_TARGET;
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid: clerkId },
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
	async getPerformanceSettings(organisationUid: number | string) {
		try {
			const clerkId = await this.toClerkId(organisationUid);
			if (!clerkId) throw new Error(`Organisation not found: ${organisationUid}`);
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid: clerkId },
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
		organisationUid: number | string,
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
			const clerkId = await this.toClerkId(organisationUid);
			if (!clerkId) throw new Error(`Organisation not found: ${organisationUid}`);
			const settings = await this.orgSettingsRepo.findOne({
				where: { organisationUid: clerkId },
			});

			if (!settings) {
				this.logger.error(`Organization settings not found for org ${organisationUid}`);
				throw new Error('Organization settings not found');
			}

			const updatedPerformance = {
				...settings.performance,
				...performance,
			};

			await this.orgSettingsRepo.update(
				{ organisationUid: clerkId },
				{ performance: updatedPerformance },
			);

			this.logger.log(`Performance settings updated for org ${organisationUid}`);
		} catch (error) {
			this.logger.error(`Error updating performance settings for org ${organisationUid}: ${error.message}`);
			throw error;
		}
	}
}

