import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { OrganisationHours } from '../../organisation/entities/organisation-hours.entity';
import { CheckInsReportsService } from './check-ins-reports.service';
import { format, addMinutes, parse, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

@Injectable()
export class CheckInsReportsScheduler {
	private readonly logger = new Logger(CheckInsReportsScheduler.name);

	constructor(
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(OrganisationHours)
		private organisationHoursRepository: Repository<OrganisationHours>,
		private checkInsReportsService: CheckInsReportsService,
	) {}

	/**
	 * Run every hour to check which organizations need reports
	 */
	@Cron(CronExpression.EVERY_HOUR)
	async checkAndSendReports(): Promise<void> {
		const operationId = `SCHEDULER_${Date.now()}`;
		this.logger.log(`[${operationId}] Checking organizations for daily check-ins reports...`);

		try {
			// Get all active organizations (need clerkOrgId/ref for OrganisationHours.organisationUid)
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
				select: ['uid', 'name', 'clerkOrgId', 'ref'],
			});

			this.logger.log(`[${operationId}] Found ${organizations.length} active organizations`);

			for (const org of organizations) {
				try {
					const orgClerkId = org.clerkOrgId ?? org.ref;
					if (!orgClerkId) {
						this.logger.debug(`[${operationId}] Skipping org ${org.uid}: no clerkOrgId/ref`);
						continue;
					}
					await this.processOrganization(org.uid, orgClerkId, operationId);
				} catch (error) {
					this.logger.error(
						`[${operationId}] Failed to process organization ${org.uid}: ${error.message}`,
						error.stack,
					);
					// Continue with next organization
				}
			}

			this.logger.log(`[${operationId}] Completed checking all organizations`);
		} catch (error) {
			this.logger.error(`[${operationId}] Scheduler error: ${error.message}`, error.stack);
		}
	}

	/**
	 * Run every 15 minutes to notify admins of visits over 1 hour without check-out.
	 */
	@Cron('0 */15 * * * *')
	async checkAndSendLongVisitAlerts(): Promise<void> {
		try {
			await this.checkInsReportsService.sendLongVisitAlerts();
		} catch (error) {
			this.logger.error(`Long-visit alerts scheduler error: ${error.message}`, error.stack);
		}
	}

	/**
	 * Process a single organization to determine if report should be sent.
	 * Uses Clerk org ID string for OrganisationHours lookup; numeric uid for report generation.
	 */
	private async processOrganization(orgUid: number, orgClerkId: string, operationId: string): Promise<void> {
		// Get organization hours (organisationUid is Clerk ID string from token/entity)
		const orgHours = await this.organisationHoursRepository.findOne({
			where: { organisationUid: orgClerkId, isDeleted: false },
		});

		if (!orgHours) {
			this.logger.debug(`[${operationId}] No hours configured for org ${orgClerkId}`);
			return;
		}

		// Check if organization is in holiday mode
		if (orgHours.holidayMode) {
			if (orgHours.holidayUntil && new Date() < orgHours.holidayUntil) {
				this.logger.debug(`[${operationId}] Org ${orgClerkId} is in holiday mode until ${orgHours.holidayUntil}`);
				return;
			}
		}

		const timezone = orgHours.timezone || 'Africa/Johannesburg';
		const now = new Date();
		const nowInTz = toZonedTime(now, timezone);

		// Get today's close time
		const closeTime = this.getTodayCloseTime(orgHours, nowInTz, timezone);

		if (!closeTime) {
			this.logger.debug(`[${operationId}] Org ${orgClerkId} is closed today`);
			return;
		}

		// Calculate report time (close time + 30 minutes)
		const reportTime = addMinutes(closeTime, 30);

		// Check if current time is within 1 hour window after report time
		const timeDiff = nowInTz.getTime() - reportTime.getTime();
		const oneHourMs = 60 * 60 * 1000;

		if (timeDiff >= 0 && timeDiff < oneHourMs) {
			// Determine report date (yesterday if before close time, today if after)
			const reportDate = nowInTz < closeTime 
				? startOfDay(addMinutes(nowInTz, -24 * 60))
				: startOfDay(nowInTz);

			this.logger.log(
				`[${operationId}] Generating report for org ${orgClerkId} - Date: ${format(reportDate, 'yyyy-MM-dd')}, Close: ${format(closeTime, 'HH:mm')}, Report: ${format(reportTime, 'HH:mm')}`,
			);

			await this.checkInsReportsService.generateDailyReport(orgUid, reportDate);
		}
	}

	/**
	 * Get today's close time for organization
	 */
	private getTodayCloseTime(
		orgHours: OrganisationHours,
		nowInTz: Date,
		timezone: string,
	): Date | null {
		const todayKey = format(nowInTz, 'yyyy-MM-dd');
		const dayOfWeek = nowInTz.getDay();
		const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
		const dayName = dayNames[dayOfWeek];

		// Check special hours first
		if (orgHours.specialHours) {
			const specialHour = orgHours.specialHours.find(sh => sh.date === todayKey);
			if (specialHour) {
				const closeTimeStr = specialHour.closeTime || '17:00';
				const [hours, minutes] = closeTimeStr.split(':').map(Number);
				const closeTime = new Date(nowInTz);
				closeTime.setHours(hours, minutes, 0, 0);
				return closeTime;
			}
		}

		// Check detailed schedule
		if (orgHours.schedule) {
			const daySchedule = orgHours.schedule[dayName as keyof typeof orgHours.schedule];
			if (daySchedule?.closed) {
				return null; // Closed today
			}
			if (daySchedule?.end) {
				const [hours, minutes] = daySchedule.end.split(':').map(Number);
				const closeTime = new Date(nowInTz);
				closeTime.setHours(hours, minutes, 0, 0);
				return closeTime;
			}
		}

		// Check weekly schedule
		const isWorkingDay = orgHours.weeklySchedule?.[dayName as keyof typeof orgHours.weeklySchedule];
		if (!isWorkingDay) {
			return null; // Closed today
		}

		// Use default close time
		if (orgHours.closeTime) {
			const closeTime = orgHours.closeTime instanceof Date 
				? orgHours.closeTime 
				: parse(String(orgHours.closeTime), 'HH:mm:ss', new Date());
			const closeTimeInTz = new Date(nowInTz);
			closeTimeInTz.setHours(closeTime.getHours(), closeTime.getMinutes(), 0, 0);
			return closeTimeInTz;
		}

		// Default to 17:00 if nothing configured
		const defaultCloseTime = new Date(nowInTz);
		defaultCloseTime.setHours(17, 0, 0, 0);
		return defaultCloseTime;
	}
}
