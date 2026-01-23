import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThanOrEqual, LessThanOrEqual, In } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Attendance } from '../entities/attendance.entity';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { Tracking } from '../../tracking/entities/tracking.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { User } from '../../user/entities/user.entity';
import { AttendanceService } from '../attendance.service';
import { GoogleMapsService } from '../../lib/services/google-maps.service';
import { LocationUtils } from '../../lib/utils/location.utils';
import { UnifiedNotificationService } from '../../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../../lib/types/unified-notification.types';
import { OrganizationHoursService } from './organization.hours.service';
import { TimezoneUtil } from '../../lib/utils/timezone.util';
import { subHours } from 'date-fns';
import { CreateCheckOutDto } from '../dto/create.attendance.check.out.dto';

@Injectable()
export class BranchLocationCheckService {
	private readonly logger = new Logger(BranchLocationCheckService.name);
	private readonly BRANCH_LOCATION_RADIUS_METERS = parseInt(
		process.env.BRANCH_LOCATION_RADIUS_METERS || '100',
		10,
	);
	private readonly notificationCache = new Set<string>();

	constructor(
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(Tracking)
		private trackingRepository: Repository<Tracking>,
		@InjectRepository(Branch)
		private branchRepository: Repository<Branch>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly attendanceService: AttendanceService,
		private readonly googleMapsService: GoogleMapsService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly organizationHoursService: OrganizationHoursService,
	) {}

	/**
	 * Scheduled cron job that runs at 16:45 daily (timezone-aware per organization)
	 * Checks if employees are still at their branch based on location
	 */
	@Cron('45 16 * * *') // Runs at 16:45 UTC - will be filtered by organization timezone
	async checkEmployeeBranchLocations(): Promise<void> {
		const operationId = `branch-location-check-${Date.now()}`;
		this.logger.log(`[${operationId}] Starting branch location check at 16:45`);

		try {
			const now = new Date();
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
			});

			this.logger.log(`[${operationId}] Found ${organizations.length} organizations to process`);

			for (const org of organizations) {
				try {
					// Get organization timezone (inline logic like attendance.service.ts)
					const orgId = org.clerkOrgId || org.ref;
					const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
					const organizationTimezone = organizationHours?.timezone || TimezoneUtil.getSafeTimezone();
					const orgCurrentTime = TimezoneUtil.getCurrentOrganizationTime(organizationTimezone);
					const orgCurrentHour = orgCurrentTime.getHours();
					const orgCurrentMinute = orgCurrentTime.getMinutes();

					// Only process if it's 16:45 in the organization's timezone (with 5 minute window)
					if (orgCurrentHour === 16 && orgCurrentMinute >= 40 && orgCurrentMinute <= 50) {
						this.logger.log(
							`[${operationId}] Processing organization ${org.uid} (${org.name}) - Local time: ${TimezoneUtil.formatInOrganizationTime(orgCurrentTime, 'HH:mm', organizationTimezone)}`,
						);
						await this.processOrganizationEmployees(operationId, org, organizationTimezone);
					} else {
						this.logger.debug(
							`[${operationId}] Skipping organization ${org.uid} - Local time: ${TimezoneUtil.formatInOrganizationTime(orgCurrentTime, 'HH:mm', organizationTimezone)} (not 16:45)`,
						);
					}
				} catch (error) {
					this.logger.error(
						`[${operationId}] Error processing organization ${org.uid}: ${error.message}`,
						error.stack,
					);
				}
			}

			this.logger.log(`[${operationId}] Branch location check completed`);
		} catch (error) {
			this.logger.error(`[${operationId}] Fatal error in branch location check: ${error.message}`, error.stack);
		}
	}

	/**
	 * Process all active employees for an organization
	 */
	private async processOrganizationEmployees(
		operationId: string,
		org: Organisation,
		timezone: string,
	): Promise<void> {
		try {
			// Get start of today in UTC (database stores UTC dates)
			const now = new Date();
			const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

			// Get all active attendance records (checked in, not checked out) for today
			// Query uses UTC dates directly (database stores UTC)
			const activeAttendances = await this.attendanceRepository.find({
				where: {
					organisation: { uid: org.uid },
					status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
					checkOut: IsNull(),
					checkIn: MoreThanOrEqual(todayStart),
				},
				relations: ['owner', 'branch'],
			});

			this.logger.log(
				`[${operationId}] Found ${activeAttendances.length} active attendance records for organization ${org.uid}`,
			);

			for (const attendance of activeAttendances) {
				try {
					await this.checkEmployeeLocation(operationId, attendance, org, timezone);
				} catch (error) {
					this.logger.error(
						`[${operationId}] Error checking location for employee ${attendance.owner?.uid}: ${error.message}`,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`[${operationId}] Error processing employees for organization ${org.uid}: ${error.message}`,
				error.stack,
			);
		}
	}

	/**
	 * Check a single employee's location against their branch
	 */
	private async checkEmployeeLocation(
		operationId: string,
		attendance: Attendance,
		org: Organisation,
		timezone: string,
	): Promise<void> {
		const userId = attendance.owner?.uid;
		const branchId = attendance.branch?.uid;

		if (!userId) {
			this.logger.warn(`[${operationId}] Attendance ${attendance.uid} has no owner, skipping`);
			return;
		}

		if (!branchId || !attendance.branch) {
			this.logger.warn(
				`[${operationId}] Attendance ${attendance.uid} has no branch assigned, skipping`,
			);
			return;
		}

		// Get branch coordinates
		const branchCoords = await this.getBranchCoordinates(operationId, attendance.branch);
		if (!branchCoords) {
			this.logger.warn(
				`[${operationId}] Could not get coordinates for branch ${branchId}, skipping employee ${userId}`,
			);
			return;
		}

		// Get latest employee location
		const employeeLocation = await this.getLatestEmployeeLocation(operationId, userId);
		if (!employeeLocation) {
			this.logger.warn(
				`[${operationId}] Could not get latest location for employee ${userId}, skipping`,
			);
			return;
		}

		// Calculate distance in meters
		const distanceKm = LocationUtils.calculateDistance(
			branchCoords.latitude,
			branchCoords.longitude,
			employeeLocation.latitude,
			employeeLocation.longitude,
		);
		const distanceMeters = distanceKm * 1000;

		this.logger.debug(
			`[${operationId}] Employee ${userId} is ${distanceMeters.toFixed(2)}m from branch ${branchId}`,
		);

		// Check if within radius
		if (distanceMeters <= this.BRANCH_LOCATION_RADIUS_METERS) {
			// Within radius - send reminder
			await this.sendLocationReminder(operationId, attendance, branchCoords, employeeLocation, distanceMeters);
		} else {
			// Outside radius - auto clock out
			await this.autoClockOut(operationId, attendance, branchCoords, employeeLocation, distanceMeters);
		}
	}

	/**
	 * Get branch coordinates by geocoding the branch address
	 */
	private async getBranchCoordinates(
		operationId: string,
		branch: Branch,
	): Promise<{ latitude: number; longitude: number } | null> {
		try {
			// Check cache first
			const cacheKey = `branch_coords_${branch.uid}`;
			const cached = await this.cacheManager.get<{ latitude: number; longitude: number }>(cacheKey);
			if (cached) {
				this.logger.debug(`[${operationId}] Using cached coordinates for branch ${branch.uid}`);
				return cached;
			}

			// Format branch address
			const branchAddress = `${branch.address.street}, ${branch.address.city}, ${branch.address.state}, ${branch.address.country}, ${branch.address.postalCode}`;

			// Geocode the address
			const geocodeResult = await this.googleMapsService.geocodeAddress(branchAddress);

			if (
				!geocodeResult ||
				!geocodeResult.address ||
				!geocodeResult.address.latitude ||
				!geocodeResult.address.longitude
			) {
				this.logger.warn(`[${operationId}] Failed to geocode branch address: ${branchAddress}`);
				return null;
			}

			const coordinates = {
				latitude: geocodeResult.address.latitude,
				longitude: geocodeResult.address.longitude,
			};

			// Cache for 24 hours (addresses don't change frequently)
			await this.cacheManager.set(cacheKey, coordinates, 86400);

			return coordinates;
		} catch (error) {
			this.logger.error(
				`[${operationId}] Error getting branch coordinates for branch ${branch.uid}: ${error.message}`,
			);
			return null;
		}
	}

	/**
	 * Get the latest location for an employee from tracking data
	 * Looks for tracking data from the last 2 hours to ensure it's recent
	 */
	private async getLatestEmployeeLocation(
		operationId: string,
		userId: number,
	): Promise<{ latitude: number; longitude: number; timestamp: Date } | null> {
		try {
			// Get location from last 2 hours (to ensure it's recent enough)
			const twoHoursAgo = subHours(new Date(), 2);

			const latestTracking = await this.trackingRepository.findOne({
				where: {
					owner: { uid: userId },
					createdAt: MoreThanOrEqual(twoHoursAgo),
				},
				order: { createdAt: 'DESC' },
				select: ['latitude', 'longitude', 'createdAt'],
			});

			if (!latestTracking) {
				this.logger.debug(
					`[${operationId}] No recent tracking data (within 2 hours) found for employee ${userId}`,
				);
				return null;
			}

			return {
				latitude: latestTracking.latitude,
				longitude: latestTracking.longitude,
				timestamp: latestTracking.createdAt,
			};
		} catch (error) {
			this.logger.error(
				`[${operationId}] Error getting latest location for employee ${userId}: ${error.message}`,
			);
			return null;
		}
	}

	/**
	 * Send reminder notification to employee (when within radius)
	 */
	private async sendLocationReminder(
		operationId: string,
		attendance: Attendance,
		branchCoords: { latitude: number; longitude: number },
		employeeLocation: { latitude: number; longitude: number; timestamp: Date },
		distanceMeters: number,
	): Promise<void> {
		const userId = attendance.owner?.uid;
		const branchName = attendance.branch?.name || 'your branch';
		const todayKey = new Date().toISOString().split('T')[0];
		const cacheKey = `branch_location_reminder_${attendance.organisationUid}_${userId}_${todayKey}`;

		// Skip if already notified today
		if (this.notificationCache.has(cacheKey)) {
			this.logger.debug(`[${operationId}] Already sent reminder to employee ${userId} today, skipping`);
			return;
		}

		try {
			const userName =
				attendance.owner?.name || attendance.owner?.username || attendance.owner?.email?.split('@')[0] || 'Team Member';

			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER,
				[userId],
				{
					userName,
					userId,
					orgId: attendance.organisationUid,
					branchId: attendance.branchUid,
					reminderType: 'branch_location_check',
					shiftEndTime: '16:45',
					timestamp: new Date().toISOString(),
				},
				{
					priority: NotificationPriority.NORMAL,
					sendEmail: false,
					customData: {
						screen: '/hr/attendance',
						action: 'branch_location_reminder',
						type: 'attendance',
						context: {
							attendanceId: attendance.uid,
							branchName,
							distanceMeters: Math.round(distanceMeters),
							employeeLat: employeeLocation.latitude,
							employeeLng: employeeLocation.longitude,
							branchLat: branchCoords.latitude,
							branchLng: branchCoords.longitude,
						},
					},
				},
			);

			this.notificationCache.add(cacheKey);
			this.logger.log(
				`[${operationId}] Sent branch location reminder to employee ${userId} (${distanceMeters.toFixed(2)}m from branch)`,
			);

			// Clean up cache after 24 hours
			setTimeout(() => {
				this.notificationCache.delete(cacheKey);
			}, 24 * 60 * 60 * 1000);
		} catch (error) {
			this.logger.error(
				`[${operationId}] Error sending reminder to employee ${userId}: ${error.message}`,
				error.stack,
			);
		}
	}

	/**
	 * Automatically clock out employee (when outside radius)
	 */
	private async autoClockOut(
		operationId: string,
		attendance: Attendance,
		branchCoords: { latitude: number; longitude: number },
		employeeLocation: { latitude: number; longitude: number; timestamp: Date },
		distanceMeters: number,
	): Promise<void> {
		const userId = attendance.owner?.uid;
		const branchName = attendance.branch?.name || 'branch';

		try {
			// Create check-out DTO
			const checkOutDto: CreateCheckOutDto = {
				owner: { uid: userId },
				checkOut: new Date(),
				checkOutLatitude: employeeLocation.latitude,
				checkOutLongitude: employeeLocation.longitude,
				checkOutNotes: `Automatically clocked out at 16:45 - Employee was ${Math.round(distanceMeters)}m away from ${branchName} branch location. Branch: ${branchCoords.latitude}, ${branchCoords.longitude}. Employee location: ${employeeLocation.latitude}, ${employeeLocation.longitude}`,
			};

			// Resolve organisation uid to Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: { uid: attendance.organisationUid },
				select: ['uid', 'clerkOrgId', 'ref'],
			});
			const orgId = organisation?.clerkOrgId || organisation?.ref;
			if (!orgId) {
				this.logger.error(`[${operationId}] Organisation ${attendance.organisationUid} has no clerkOrgId or ref`);
				return;
			}

			// Call attendance service to clock out
			const result = await this.attendanceService.checkOut(
				checkOutDto,
				orgId,
				attendance.branchUid,
			);

			if (result && result.data) {
				this.logger.log(
					`[${operationId}] Successfully auto clocked out employee ${userId} (${distanceMeters.toFixed(2)}m from branch)`,
				);

				// Send notification about auto clock-out
				const userName =
					attendance.owner?.name || attendance.owner?.username || attendance.owner?.email?.split('@')[0] || 'Team Member';

				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER,
					[userId],
					{
						userName,
						userId,
						orgId: attendance.organisationUid,
						branchId: attendance.branchUid,
						reminderType: 'auto_clock_out',
						shiftEndTime: '16:45',
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.HIGH,
						sendEmail: false,
						customData: {
							screen: '/hr/attendance',
							action: 'auto_clock_out',
							type: 'attendance',
							context: {
								attendanceId: attendance.uid,
								branchName,
								distanceMeters: Math.round(distanceMeters),
								reason: 'not_at_branch',
							},
						},
					},
				);
			} else {
				this.logger.warn(
					`[${operationId}] Auto clock-out returned no data for employee ${userId}`,
				);
			}
		} catch (error) {
			this.logger.error(
				`[${operationId}] Error auto clocking out employee ${userId}: ${error.message}`,
				error.stack,
			);
		}
	}
}
