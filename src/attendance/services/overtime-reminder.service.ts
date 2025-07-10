import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, DataSource } from 'typeorm';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { User } from '../../user/entities/user.entity';
import { OrganisationHours } from '../../organisation/entities/organisation-hours.entity';
import { EmailType } from '../../lib/enums/email.enums';
import { OvertimeReminderData } from '../../lib/types/email-templates.types';

@Injectable()
export class OvertimeReminderService {
	private readonly logger = new Logger(OvertimeReminderService.name);
	private readonly processedReminders = new Set<string>(); // Track sent reminders for the day
	private isProcessing = false; // Prevent concurrent executions

	constructor(
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(OrganisationHours)
		private organisationHoursRepository: Repository<OrganisationHours>,
		private eventEmitter: EventEmitter2,
		private dataSource: DataSource,
	) {}

	/**
	 * Check if database connection is healthy
	 */
	private async isDatabaseConnected(): Promise<boolean> {
		try {
			if (!this.dataSource.isInitialized) {
				this.logger.warn('Database connection not initialized');
				return false;
			}

			// Try a simple query to test connection
			await this.dataSource.query('SELECT 1');
			return true;
		} catch (error) {
			this.logger.error(`Database connection check failed: ${error.message}`);
			return false;
		}
	}

	/**
	 * Runs daily at 5am to check for employees working overtime
	 */
	@Cron('0 0 5 * * *', {
		name: 'overtime-reminder-check',
		timeZone: 'Africa/Johannesburg',
	})
	async checkOvertimeReminders(): Promise<void> {
		// Prevent concurrent executions
		if (this.isProcessing) {
			this.logger.debug('Overtime check already in progress, skipping...');
			return;
		}

		this.isProcessing = true;

		try {
			this.logger.log('🕐 Starting overtime reminder check...');

			// Check database connection first
			const isConnected = await this.isDatabaseConnected();
			if (!isConnected) {
				this.logger.warn('⚠️ Database connection not available, skipping overtime check');
				return;
			}

			const now = new Date();
			const organizations = await this.getActiveOrganizations();

			if (!organizations || organizations.length === 0) {
				this.logger.debug('No active organizations found for overtime check');
				return;
			}

			let processedCount = 0;
			for (const orgHours of organizations) {
				try {
					const result = await this.processOrganizationOvertime(orgHours, now);
					if (result) processedCount++;
				} catch (error) {
					this.logger.error(`Error processing organization ${orgHours.organisation?.name || 'unknown'}: ${error.message}`);
				}
			}

			this.logger.log(`✅ Overtime reminder check completed (${processedCount} organizations processed)`);
		} catch (error) {
			this.logger.error('❌ Error in overtime reminder check:', error);
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Get all organizations with defined hours
	 */
	private async getActiveOrganizations(): Promise<OrganisationHours[]> {
		try {
			return await this.organisationHoursRepository.find({
				where: {
					closeTime: Not(IsNull()),
					openTime: Not(IsNull()),
				},
				relations: ['organisation'],
			});
		} catch (error) {
			this.logger.error(`Error fetching active organizations: ${error.message}`);
			return [];
		}
	}

	/**
	 * Process overtime for a specific organization
	 */
	private async processOrganizationOvertime(
		orgHours: OrganisationHours,
		currentTime: Date,
	): Promise<boolean> {
		try {
			// Validate organization data
			if (!orgHours?.organisation?.uid || !orgHours.closeTime) {
				this.logger.warn('Invalid organization data, skipping');
				return false;
			}

			// Get today's close time for this organization
			const { closeTimeToday, isAfterCloseTime, minutesPastClose } = 
				this.calculateOvertimeWindow(orgHours, currentTime);

			// Only process if we're 10+ minutes past close time
			if (!isAfterCloseTime || minutesPastClose < 10) {
				return false;
			}

			this.logger.log(
				`📊 Checking overtime for ${orgHours.organisation.name} - ${minutesPastClose} minutes past close time`,
			);

			// Get active check-ins that started before close time (smart filtering)
			const activeCheckIns = await this.getEligibleOvertimeCheckIns(
				orgHours.organisation.uid,
				closeTimeToday,
			);

			if (!activeCheckIns || activeCheckIns.length === 0) {
				this.logger.debug(`No active check-ins found for ${orgHours.organisation.name}`);
				return false;
			}

			let processedCheckIns = 0;
			for (const checkIn of activeCheckIns) {
				try {
					const result = await this.processOvertimeCheckIn(checkIn, orgHours, currentTime, closeTimeToday);
					if (result) processedCheckIns++;
				} catch (error) {
					this.logger.error(`Error processing check-in ${checkIn.uid}: ${error.message}`);
				}
			}

			this.logger.debug(`Processed ${processedCheckIns} check-ins for ${orgHours.organisation.name}`);
			return true;
		} catch (error) {
			this.logger.error(`Error in processOrganizationOvertime: ${error.message}`);
			return false;
		}
	}

	/**
	 * Calculate if we're in the overtime window for an organization
	 */
	private calculateOvertimeWindow(orgHours: OrganisationHours, currentTime: Date) {
		try {
			const today = new Date();
			const [closeHour, closeMinute] = orgHours.closeTime.split(':').map(Number);
			
			const closeTimeToday = new Date(
				today.getFullYear(),
				today.getMonth(),
				today.getDate(),
				closeHour,
				closeMinute,
			);

			const isAfterCloseTime = currentTime > closeTimeToday;
			const minutesPastClose = isAfterCloseTime 
				? Math.floor((currentTime.getTime() - closeTimeToday.getTime()) / (1000 * 60))
				: 0;

			return { closeTimeToday, isAfterCloseTime, minutesPastClose };
		} catch (error) {
			this.logger.error(`Error calculating overtime window: ${error.message}`);
			return { closeTimeToday: new Date(), isAfterCloseTime: false, minutesPastClose: 0 };
		}
	}

	/**
	 * Get active check-ins that started before close time (smart filtering)
	 * SMART LOGIC: Only shifts that started BEFORE the organization close time
	 */
	private async getEligibleOvertimeCheckIns(
		organizationId: number,
		closeTimeToday: Date,
	): Promise<CheckIn[]> {
		try {
			// Check database connection before query
			const isConnected = await this.isDatabaseConnected();
			if (!isConnected) {
				this.logger.warn('Database connection not available for check-ins query');
				return [];
			}

			const startOfDay = new Date();
			startOfDay.setHours(0, 0, 0, 0);

			return await this.checkInRepository.createQueryBuilder('checkIn')
				.leftJoinAndSelect('checkIn.owner', 'owner')
				.leftJoinAndSelect('owner.organisation', 'organisation')
				.where('checkIn.checkOutTime IS NULL') // Still active (not clocked out)
				.andWhere('checkIn.checkInTime >= :startOfDay', { startOfDay })
				.andWhere('checkIn.checkInTime < :closeTimeToday', { closeTimeToday }) // CRITICAL: Only shifts that started before close time
				.andWhere('organisation.uid = :organizationId', { organizationId })
				.getMany();
		} catch (error) {
			this.logger.error(`Error fetching eligible overtime check-ins: ${error.message}`);
			return [];
		}
	}

	/**
	 * Process individual check-in for overtime reminder
	 */
	private async processOvertimeCheckIn(
		checkIn: CheckIn,
		orgHours: OrganisationHours,
		currentTime: Date,
		closeTimeToday: Date,
	): Promise<boolean> {
		try {
			// Validate check-in data
			if (!checkIn?.uid || !checkIn.owner?.email) {
				this.logger.warn('Invalid check-in data, skipping');
				return false;
			}

			const reminderKey = `${checkIn.uid}-${currentTime.toDateString()}`;

			// Prevent duplicate reminders for the same shift on the same day
			if (this.processedReminders.has(reminderKey)) {
				return false;
			}

			const overtimeMinutes = Math.floor(
				(currentTime.getTime() - closeTimeToday.getTime()) / (1000 * 60),
			);

			// Only send reminder if they've been in overtime for 10+ minutes
			if (overtimeMinutes >= 10) {
				const success = await this.sendOvertimeReminder(checkIn, orgHours, currentTime, overtimeMinutes);
				if (success) {
					this.processedReminders.add(reminderKey);
					return true;
				}
			}

			return false;
		} catch (error) {
			this.logger.error(`Error processing overtime check-in: ${error.message}`);
			return false;
		}
	}

	/**
	 * Send overtime reminder email
	 */
	private async sendOvertimeReminder(
		checkIn: CheckIn,
		orgHours: OrganisationHours,
		currentTime: Date,
		overtimeMinutes: number,
	): Promise<boolean> {
		try {
			const user = checkIn.owner;
			
			// Validate user data
			if (!user?.email || !user.name) {
				this.logger.warn(`Invalid user data for check-in ${checkIn.uid}, skipping reminder`);
				return false;
			}

			const shiftDuration = this.calculateShiftDuration(checkIn.checkInTime, currentTime);
			const overtimeDuration = this.formatDuration(overtimeMinutes);

			const emailData: OvertimeReminderData = {
				name: `${user.name} ${user.surname || ''}`.trim(), // Required by BaseEmailData
				employeeName: `${user.name} ${user.surname || ''}`.trim(),
				employeeEmail: user.email,
				checkInTime: checkIn.checkInTime.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				}),
				organizationCloseTime: this.formatTime(orgHours.closeTime),
				currentTime: currentTime.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				}),
				minutesOvertime: overtimeMinutes,
				overtimeDuration,
				shiftDuration,
				organizationName: orgHours.organisation.name,
				clockOutUrl: `${process.env.DASHBOARD_URL || process.env.APP_URL}/attendance`,
				dashboardUrl: `${process.env.DASHBOARD_URL || process.env.APP_URL}/dashboard`,
			};

			// Emit email event
			this.eventEmitter.emit('email.send', {
				type: EmailType.OVERTIME_REMINDER,
				to: user.email,
				data: emailData,
			});

			this.logger.log(
				`📧 Overtime reminder sent to ${user.name} (${overtimeMinutes} minutes overtime)`,
			);

			return true;
		} catch (error) {
			this.logger.error(`Failed to send overtime reminder to ${checkIn.owner?.email || 'unknown'}:`, error);
			return false;
		}
	}

	/**
	 * Calculate total shift duration
	 */
	private calculateShiftDuration(checkInTime: Date, currentTime: Date): string {
		const totalMinutes = Math.floor(
			(currentTime.getTime() - checkInTime.getTime()) / (1000 * 60),
		);
		return this.formatDuration(totalMinutes);
	}

	/**
	 * Format duration in minutes to human-readable format
	 */
	private formatDuration(totalMinutes: number): string {
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;

		if (hours === 0) {
			return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
		}

		if (minutes === 0) {
			return `${hours} hour${hours !== 1 ? 's' : ''}`;
		}

		return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
	}

	/**
	 * Format time from HH:mm to readable format
	 */
	private formatTime(timeString: string): string {
		const [hour, minute] = timeString.split(':').map(Number);
		const date = new Date();
		date.setHours(hour, minute);
		
		return date.toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: true,
		});
	}

	/**
	 * Clear processed reminders at midnight to reset for new day
	 */
	@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
		name: 'reset-overtime-reminders',
		timeZone: 'Africa/Johannesburg',
	})
	async resetDailyReminders(): Promise<void> {
		try {
			this.processedReminders.clear();
			this.logger.log('🔄 Reset overtime reminder tracking for new day');
		} catch (error) {
			this.logger.error(`Error resetting daily reminders: ${error.message}`);
		}
	}

	/**
	 * Manual trigger for testing (optional)
	 */
	async triggerOvertimeCheck(): Promise<{ message: string; processed: number }> {
		try {
			// Check database connection first
			const isConnected = await this.isDatabaseConnected();
			if (!isConnected) {
				return {
					message: 'Database connection not available',
					processed: 0,
				};
			}

			const beforeCount = this.processedReminders.size;
			await this.checkOvertimeReminders();
			const afterCount = this.processedReminders.size;
			
			return {
				message: 'Overtime check completed',
				processed: afterCount - beforeCount,
			};
		} catch (error) {
			this.logger.error(`Error in manual overtime check trigger: ${error.message}`);
			return {
				message: `Error: ${error.message}`,
				processed: 0,
			};
		}
	}
} 