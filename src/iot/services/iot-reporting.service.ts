import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Device, DeviceRecords } from '../entities/iot.entity';
import { DeviceStatus } from '../../lib/enums/iot';
import {
	DeviceMonitoringReport,
	DeviceReportSummary,
	DeviceReportBreakdown,
	DeviceReportDevice,
	DeviceAlerts,
	DeviceInsights,
	DeviceRecommendations,
	DevicePerformanceMetrics,
	DeviceWorkingHours,
} from '../../lib/interfaces/iot.interface';
import { DeviceReportOptions, IoTServiceResponse } from '../../lib/types/iot.types';
import { OrganisationHoursService } from '../../organisation/services/organisation-hours.service';
import { TimezoneUtil } from '../../lib/utils/timezone.util';

/**
 * IoT Device Reporting Service
 *
 * Generates comprehensive reports for IoT device monitoring, similar to attendance reports.
 * Provides morning and evening reports, analytics, and recommendations.
 */
@Injectable()
export class IoTReportingService {
	private readonly logger = new Logger(IoTReportingService.name);

	constructor(
		@InjectRepository(Device)
		private readonly deviceRepository: Repository<Device>,
		@InjectRepository(DeviceRecords)
		private readonly deviceRecordsRepository: Repository<DeviceRecords>,
		private readonly eventEmitter: EventEmitter2,
		private readonly organisationHoursService: OrganisationHoursService,
	) {}

	/**
	 * Generate Morning IoT Device Report
	 *
	 * Similar to morning attendance report, focuses on:
	 * - Device startup times
	 * - Early/late opening detection
	 * - Device availability
	 * - Overnight issues
	 */
	async generateMorningReport(options: DeviceReportOptions): Promise<IoTServiceResponse<DeviceMonitoringReport>> {
		const requestId = `morning_report_${Date.now()}`;

		try {
			this.logger.log(`[${requestId}] Generating morning IoT device report for organization ${options.orgId}`);

			const startOfDay = new Date();
			startOfDay.setHours(0, 0, 0, 0);

			const endOfDay = new Date();
			endOfDay.setHours(23, 59, 59, 999);

			// Get all devices for organization
			const devices = await this.getDevicesForReport(options);

			// Get today's records
			const todayRecords = await this.getTodayRecords(
				devices.map((d) => d.id),
				startOfDay,
				endOfDay,
			);

			// Generate report sections
			const summary = await this.generateMorningSummary(devices, todayRecords);
			const deviceBreakdown = await this.generateDeviceBreakdown(devices, todayRecords, 'morning');
			const alerts = await this.generateMorningAlerts(devices, todayRecords);
			const insights = this.generateMorningInsights(devices, todayRecords);
			const recommendations = this.generateMorningRecommendations(devices, todayRecords, summary);

			const report: DeviceMonitoringReport = {
				reportDate: new Date().toISOString().split('T')[0],
				generatedAt: new Date().toISOString(),
				organizationId: options.orgId,
				summary,
				deviceBreakdown,
				alerts,
				insights,
				recommendations,
			};

			// Emit event for notifications
			this.eventEmitter.emit('iot.report.generated', {
				type: 'morning',
				orgId: options.orgId,
				report,
				requestId,
			});

			this.logger.log(`[${requestId}] Morning IoT report generated successfully`);

			return {
				success: true,
				message: 'Morning IoT device report generated successfully',
				data: report,
				timestamp: new Date(),
				requestId,
			};
		} catch (error) {
			this.logger.error(`[${requestId}] Failed to generate morning report: ${error.message}`, error.stack);

			return {
				success: false,
				message: 'Failed to generate morning IoT device report',
				error: error.message,
				timestamp: new Date(),
				requestId,
			};
		}
	}

	/**
	 * Generate Evening IoT Device Report
	 *
	 * Similar to evening attendance report, focuses on:
	 * - Device shutdown times
	 * - Daily usage analytics
	 * - Performance metrics
	 * - Next day preparation
	 */
	async generateEveningReport(options: DeviceReportOptions): Promise<IoTServiceResponse<DeviceMonitoringReport>> {
		const requestId = `evening_report_${Date.now()}`;

		try {
			this.logger.log(`[${requestId}] Generating evening IoT device report for organization ${options.orgId}`);

			const startOfDay = new Date();
			startOfDay.setHours(0, 0, 0, 0);

			const endOfDay = new Date();
			endOfDay.setHours(23, 59, 59, 999);

			const devices = await this.getDevicesForReport(options);
			const todayRecords = await this.getTodayRecords(
				devices.map((d) => d.id),
				startOfDay,
				endOfDay,
			);

			const summary = await this.generateEveningSummary(devices, todayRecords);
			const deviceBreakdown = await this.generateDeviceBreakdown(devices, todayRecords, 'evening');
			const alerts = await this.generateEveningAlerts(devices, todayRecords);
			const insights = this.generateEveningInsights(devices, todayRecords);
			const recommendations = this.generateEveningRecommendations(devices, todayRecords, summary);

			const report: DeviceMonitoringReport = {
				reportDate: new Date().toISOString().split('T')[0],
				generatedAt: new Date().toISOString(),
				organizationId: options.orgId,
				summary,
				deviceBreakdown,
				alerts,
				insights,
				recommendations,
			};

			this.eventEmitter.emit('iot.report.generated', {
				type: 'evening',
				orgId: options.orgId,
				report,
				requestId,
			});

			this.logger.log(`[${requestId}] Evening IoT report generated successfully`);

			return {
				success: true,
				message: 'Evening IoT device report generated successfully',
				data: report,
				timestamp: new Date(),
				requestId,
			};
		} catch (error) {
			this.logger.error(`[${requestId}] Failed to generate evening report: ${error.message}`, error.stack);

			return {
				success: false,
				message: 'Failed to generate evening IoT device report',
				error: error.message,
				timestamp: new Date(),
				requestId,
			};
		}
	}

	/**
	 * Calculate device open/close times and punctuality
	 */
	async calculateDeviceTimings(
		deviceId: number,
		dateRange?: { start: Date; end: Date },
	): Promise<DevicePerformanceMetrics> {
		const requestId = `timing_calc_${deviceId}_${Date.now()}`;

		try {
			this.logger.log(`[${requestId}] Calculating device timings for device ${deviceId}`);

			const device = await this.deviceRepository.findOne({ where: { id: deviceId } });
			if (!device) {
				throw new NotFoundException(`Device with ID ${deviceId} not found`);
			}

			// Default to last 30 days if no range provided
			const endDate = dateRange?.end || new Date();
			const startDate = dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

			const records = await this.deviceRecordsRepository.find({
				where: {
					deviceId,
					createdAt: Between(startDate, endDate),
				},
				order: { createdAt: 'ASC' },
			});

			// Get organization hours
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;

			if (!orgHours) {
				throw new NotFoundException(`Organization hours not configured for device ${deviceId}`);
			}

			// Get organization timezone
			const orgTimezone = orgHours.timezone || TimezoneUtil.AFRICA_JOHANNESBURG;

			// Parse organization open/close times
			const [openHour, openMinute] = orgHours.openTime.split(':').map(Number);
			const [closeHour, closeMinute] = orgHours.closeTime.split(':').map(Number);
			const expectedOpenTime = (openHour * 60 + openMinute) * 60; // Convert to seconds
			const expectedCloseTime = (closeHour * 60 + closeMinute) * 60; // Convert to seconds

			// 5-minute tolerance for late openings/closings
			const TOLERANCE_SECONDS = 5 * 60;

			let onTimeOpenings = 0;
			let lateOpenings = 0;
			let onTimeClosings = 0;
			let earlyClosings = 0;
			let totalEvents = 0;
			let totalUptime = 0;

			// Group records by date and extract first opening and last closing per day
			// IMPORTANT: We evaluate ALL opening times regardless of hour - early openings (before org open time) 
			// are treated as acceptable and count as "on time"
			const dailyOpenings = new Map<string, number>();
			const dailyClosings = new Map<string, number>();

			for (const record of records) {
				totalEvents++;

				if (record.openTime) {
					const openDate = new Date(record.openTime as unknown as Date);
					// Use TimezoneUtil to get minutes since midnight in organization timezone
					const openMinutes = TimezoneUtil.getMinutesSinceMidnight(openDate, orgTimezone);
					const actualOpenTime = openMinutes * 60; // Convert to seconds
					
					// Process all opening times - no time window filter
					// Early openings are acceptable and will be evaluated against org open time
					// Get date key in organization timezone
					const openDateOrg = TimezoneUtil.toOrganizationTime(openDate, orgTimezone);
					const dateKey = openDateOrg.toISOString().split('T')[0]; // YYYY-MM-DD
					
					// Keep only the earliest opening for each day
					if (!dailyOpenings.has(dateKey) || actualOpenTime < dailyOpenings.get(dateKey)!) {
						dailyOpenings.set(dateKey, actualOpenTime);
					}
				}

				if (record.closeTime) {
					const closeDate = new Date(record.closeTime as unknown as Date);
					// Use TimezoneUtil to get minutes since midnight in organization timezone
					const closeMinutes = TimezoneUtil.getMinutesSinceMidnight(closeDate, orgTimezone);
					const actualCloseTime = closeMinutes * 60; // Convert to seconds
					// Get date key in organization timezone
					const closeDateOrg = TimezoneUtil.toOrganizationTime(closeDate, orgTimezone);
					const dateKey = closeDateOrg.toISOString().split('T')[0]; // YYYY-MM-DD
					
					// Keep only the latest closing for each day
					if (!dailyClosings.has(dateKey) || actualCloseTime > dailyClosings.get(dateKey)!) {
						dailyClosings.set(dateKey, actualCloseTime);
					}
				}
			}

			// Evaluate opening times using first opening per day
			// Early openings (before org open time) are always acceptable - they count as "on time"
			// Condition: timeDiff <= TOLERANCE_SECONDS accepts:
			//   - Early openings (timeDiff < 0) → ACCEPTED ✓
			//   - On-time/slightly late (0 <= timeDiff <= 5 min) → ACCEPTED ✓
			//   - More than 5 min late (timeDiff > 5 min) → REJECTED ✗
			dailyOpenings.forEach((actualOpenTime) => {
				const timeDiff = actualOpenTime - expectedOpenTime;
				if (timeDiff <= TOLERANCE_SECONDS) {
					onTimeOpenings++;
				} else {
					lateOpenings++;
				}
			});

			// Evaluate closing times using last closing per day
			dailyClosings.forEach((actualCloseTime) => {
				const timeDiff = actualCloseTime - expectedCloseTime;
				if (timeDiff >= -TOLERANCE_SECONDS) {
					onTimeClosings++;
				} else {
					earlyClosings++;
				}
			});

			// Calculate uptime using all records (not just daily summaries)
			for (const record of records) {
				if (record.openTime && record.closeTime) {
					const openMs = (record.openTime as unknown as Date).getTime();
					const closeMs = (record.closeTime as unknown as Date).getTime();
					totalUptime += Math.max(0, Math.floor((closeMs - openMs) / 1000));
				}
			}

			const totalDaysWithOpenings = dailyOpenings.size;
			const totalDaysWithClosings = dailyClosings.size;
			const openTimePunctuality = totalDaysWithOpenings > 0 ? (onTimeOpenings / totalDaysWithOpenings) * 100 : 0;
			const closeTimePunctuality = totalDaysWithClosings > 0 ? (onTimeClosings / totalDaysWithClosings) * 100 : 0;
			const uptimePercentage = totalEvents > 0 ? (totalUptime / (totalEvents * 9 * 3600)) * 100 : 0; // Assuming 9-hour days
			const efficiencyScore = (openTimePunctuality + closeTimePunctuality + uptimePercentage) / 3;
			const reliabilityScore = ((totalEvents - lateOpenings - earlyClosings) / Math.max(totalEvents, 1)) * 100;

			const metrics: DevicePerformanceMetrics = {
				deviceId,
				openTimePunctuality,
				closeTimePunctuality,
				uptimePercentage,
				efficiencyScore,
				reliabilityScore,
				maintenanceNeeded: reliabilityScore < 80 || uptimePercentage < 90,
			};

			this.logger.log(`[${requestId}] Device timings calculated successfully`);
			return metrics;
		} catch (error) {
			this.logger.error(`[${requestId}] Failed to calculate device timings: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Send IoT reports to admins and owners
	 */
	async sendReportsToAdmins(report: DeviceMonitoringReport, reportType: 'morning' | 'evening'): Promise<void> {
		const requestId = `email_report_${reportType}_${Date.now()}`;

		try {
			this.logger.log(
				`[${requestId}] Sending ${reportType} IoT report for organization ${report.organizationId}`,
			);

			// Emit event for email service to handle
			this.eventEmitter.emit('iot.report.send_email', {
				type: reportType,
				report,
				recipients: ['admin@loro.co.za', 'owner@loro.co.za'], // Can be made configurable
				requestId,
			});

			this.logger.log(`[${requestId}] ${reportType} IoT report email sent successfully`);
		} catch (error) {
			this.logger.error(
				`[${requestId}] Failed to send ${reportType} report email: ${error.message}`,
				error.stack,
			);
			throw error;
		}
	}

	// Private helper methods

	private async getDevicesForReport(options: DeviceReportOptions): Promise<Device[]> {
		const where: any = { orgID: options.orgId, isDeleted: false };

		if (options.branchIds?.length) {
			where.branchID = options.branchIds.length === 1 ? options.branchIds[0] : { $in: options.branchIds };
		}

		if (options.deviceIds?.length) {
			where.id = options.deviceIds.length === 1 ? options.deviceIds[0] : { $in: options.deviceIds };
		}

		return await this.deviceRepository.find({ where });
	}

	private async getTodayRecords(deviceIds: number[], startOfDay: Date, endOfDay: Date): Promise<DeviceRecords[]> {
		return await this.deviceRecordsRepository.find({
			where: {
				deviceId: deviceIds.length === 1 ? deviceIds[0] : In(deviceIds),
				createdAt: Between(startOfDay, endOfDay),
			},
			relations: ['device'],
		});
	}

	private async generateMorningSummary(devices: Device[], records: DeviceRecords[]): Promise<DeviceReportSummary> {
		const totalDevices = devices.length;
		const activeDevices = devices.filter((d) => d.currentStatus !== DeviceStatus.OFFLINE).length;
		const onlineDevices = devices.filter((d) => d.currentStatus === DeviceStatus.ONLINE).length;
		const offlineDevices = totalDevices - onlineDevices;

		const todayOpenEvents = records.filter((r) => r.openTime).length;
		// Use organization hours if available, otherwise default
		const orgRef = devices[0]?.orgID ? String(devices[0].orgID) : null;
		const orgHoursArr = orgRef ? await this.organisationHoursService.findAll(orgRef).catch(() => []) : [];
		const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;
		const orgTimezone = orgHours?.timezone || TimezoneUtil.AFRICA_JOHANNESBURG;
		const [openHour, openMinute] = orgHours?.openTime ? orgHours.openTime.split(':').map(Number) : [8, 0];
		const expectedOpenTime = (openHour * 60 + openMinute) * 60;
		const TOLERANCE_SECONDS = 5 * 60;
		const lateOpenings = records.filter((r) => {
			if (!r.openTime) return false;
			const openDate = new Date(r.openTime as unknown as Date);
			// Use TimezoneUtil to get minutes since midnight in organization timezone
			const openMinutes = TimezoneUtil.getMinutesSinceMidnight(openDate, orgTimezone);
			const actualOpen = openMinutes * 60; // Convert to seconds
			return Math.abs(actualOpen - expectedOpenTime) > TOLERANCE_SECONDS && actualOpen > expectedOpenTime;
		}).length;

		const punctualityRate = todayOpenEvents > 0 ? ((todayOpenEvents - lateOpenings) / todayOpenEvents) * 100 : 0;
		const organizationEfficiency = (onlineDevices / totalDevices) * punctualityRate;

		return {
			totalDevices,
			activeDevices,
			onlineDevices,
			offlineDevices,
			totalOpenEvents: todayOpenEvents,
			totalCloseEvents: 0, // Morning report focuses on openings
			averageUptime: (onlineDevices / totalDevices) * 100,
			organizationEfficiency,
			totalWorkingHours: 0, // Will be calculated in evening
			lateOpenings,
			earlyClosings: 0,
			punctualityRate,
		};
	}

	private async generateEveningSummary(devices: Device[], records: DeviceRecords[]): Promise<DeviceReportSummary> {
		const totalDevices = devices.length;
		const activeDevices = devices.filter((d) => d.currentStatus !== DeviceStatus.OFFLINE).length;
		const onlineDevices = devices.filter((d) => d.currentStatus === DeviceStatus.ONLINE).length;
		const offlineDevices = totalDevices - onlineDevices;

		const todayCloseEvents = records.filter((r) => r.closeTime).length;
		// Use organization hours if available, otherwise default
		const orgRef = devices[0]?.orgID ? String(devices[0].orgID) : null;
		const orgHoursArr = orgRef ? await this.organisationHoursService.findAll(orgRef).catch(() => []) : [];
		const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;
		const orgTimezone = orgHours?.timezone || TimezoneUtil.AFRICA_JOHANNESBURG;
		const [closeHour, closeMinute] = orgHours?.closeTime ? orgHours.closeTime.split(':').map(Number) : [17, 0];
		const expectedCloseTime = (closeHour * 60 + closeMinute) * 60;
		const TOLERANCE_SECONDS = 5 * 60;
		const earlyClosings = records.filter((r) => {
			if (!r.closeTime) return false;
			const closeDate = new Date(r.closeTime as unknown as Date);
			// Use TimezoneUtil to get minutes since midnight in organization timezone
			const closeMinutes = TimezoneUtil.getMinutesSinceMidnight(closeDate, orgTimezone);
			const actualClose = closeMinutes * 60; // Convert to seconds
			return Math.abs(actualClose - expectedCloseTime) > TOLERANCE_SECONDS && actualClose < expectedCloseTime;
		}).length;

		const totalWorkingHours = records.reduce((total, record) => {
			if (record.openTime && record.closeTime) {
				const openMs = (record.openTime as unknown as Date).getTime();
				const closeMs = (record.closeTime as unknown as Date).getTime();
				return total + (Math.max(0, closeMs - openMs) / 1000) / 3600;
			}
			return total;
		}, 0);

		const punctualityRate =
			todayCloseEvents > 0 ? ((todayCloseEvents - earlyClosings) / todayCloseEvents) * 100 : 0;
		const organizationEfficiency = (onlineDevices / totalDevices) * punctualityRate;

		return {
			totalDevices,
			activeDevices,
			onlineDevices,
			offlineDevices,
			totalOpenEvents: records.filter((r) => r.openTime).length,
			totalCloseEvents: todayCloseEvents,
			averageUptime: (onlineDevices / totalDevices) * 100,
			organizationEfficiency,
			totalWorkingHours,
			lateOpenings: 0, // Evening report focuses on closings
			earlyClosings,
			punctualityRate,
		};
	}

	private async generateDeviceBreakdown(
		devices: Device[],
		records: DeviceRecords[],
		reportType: 'morning' | 'evening',
	): Promise<DeviceReportBreakdown[]> {
		// Group devices by branch
		const branchGroups = devices.reduce((groups, device) => {
			const branchId = device.branchID;
			if (!groups[branchId]) {
				groups[branchId] = [];
			}
			groups[branchId].push(device);
			return groups;
		}, {} as Record<number, Device[]>);

		const breakdown: DeviceReportBreakdown[] = [];

		for (const [branchId, branchDevices] of Object.entries(branchGroups)) {
			const branchRecords = records.filter((r) => branchDevices.some((d) => d.id === r.deviceId));

			// Get organization hours for this branch (all devices in branch share same org)
			const orgRef = branchDevices[0]?.orgID ? String(branchDevices[0].orgID) : null;
			const orgHoursArr = orgRef ? await this.organisationHoursService.findAll(orgRef).catch(() => []) : [];
			const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;

			const deviceReportDevices: DeviceReportDevice[] = branchDevices.map((device) => {
				const deviceRecords = branchRecords.filter((r) => r.deviceId === device.id);
				const latestRecord = deviceRecords.sort(
					(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
				)[0];

				const todayRecord = deviceRecords.find((r) => {
					const recordDate = new Date(r.createdAt).toDateString();
					const today = new Date().toDateString();
					return recordDate === today;
				});

				return {
					id: device.id,
					deviceID: device.deviceID,
					deviceType: device.deviceType,
					location: device.devicLocation,
					currentStatus: device.currentStatus,
					lastOpenTime: latestRecord?.openTime
						? (latestRecord.openTime as unknown as Date).toISOString()
						: undefined,
					lastCloseTime: latestRecord?.closeTime
						? (latestRecord.closeTime as unknown as Date).toISOString()
						: undefined,
					todayOpenTime: todayRecord?.openTime
						? (todayRecord.openTime as unknown as Date).toISOString()
						: undefined,
					todayCloseTime: todayRecord?.closeTime
						? (todayRecord.closeTime as unknown as Date).toISOString()
						: undefined,
					isLateOpening: this.checkLateOpening(todayRecord?.openTime as unknown as Date | undefined, orgHours),
					isEarlyClosing: this.checkEarlyClosing(todayRecord?.closeTime as unknown as Date | undefined, orgHours),
					lateMinutes: this.calculateLateMinutes(todayRecord?.openTime as unknown as Date | undefined, orgHours),
					efficiency: this.calculateDeviceEfficiency(device),
					uptime: device.currentStatus === DeviceStatus.ONLINE ? 100 : 0,
					eventCount: deviceRecords.length,
				};
			});

			const activeDevices = branchDevices.filter((d) => d.currentStatus !== DeviceStatus.OFFLINE).length;
			const totalEvents = branchRecords.length;
			const punctualDevices = deviceReportDevices.filter((d) => !d.isLateOpening && !d.isEarlyClosing).length;

			breakdown.push({
				branchId: parseInt(branchId),
				branchName: `Branch ${branchId}`, // Should get actual branch name from branch service
				totalDevices: branchDevices.length,
				activeDevices,
				averageUptime: (activeDevices / branchDevices.length) * 100,
				totalEvents,
				punctualityRate: branchDevices.length > 0 ? (punctualDevices / branchDevices.length) * 100 : 0,
				devices: deviceReportDevices,
			});
		}

		return breakdown;
	}

	private async generateMorningAlerts(devices: Device[], records: DeviceRecords[]): Promise<DeviceAlerts> {
		const alerts: DeviceAlerts = {
			critical: [],
			warning: [],
			info: [],
		};

		// Critical alerts
		const offlineDevices = devices.filter((d) => d.currentStatus === DeviceStatus.OFFLINE);
		if (offlineDevices.length > 0) {
			alerts.critical.push(`${offlineDevices.length} device(s) are offline and not responding`);
		}

		const devicesInError = devices.filter((d) => d.currentStatus === DeviceStatus.MAINTENANCE);
		if (devicesInError.length > 0) {
			alerts.critical.push(`${devicesInError.length} device(s) are in error state and need immediate attention`);
		}

		// Warning alerts
		const maintenanceDevices = devices.filter((d) => d.currentStatus === DeviceStatus.MAINTENANCE);
		if (maintenanceDevices.length > 0) {
			alerts.warning.push(`${maintenanceDevices.length} device(s) are in maintenance mode`);
		}

		// Get org hours for late opening check
		const orgRef = devices[0]?.orgID ? String(devices[0].orgID) : null;
		const orgHoursArr = orgRef ? await this.organisationHoursService.findAll(orgRef).catch(() => []) : [];
		const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;
		const lateDevices = records.filter((r) => this.checkLateOpening(r.openTime, orgHours));
		if (lateDevices.length > 0) {
			alerts.warning.push(`${lateDevices.length} device(s) opened late this morning`);
		}

		// Info alerts
		if (devices.length > 0) {
			const onlinePercentage =
				(devices.filter((d) => d.currentStatus === DeviceStatus.ONLINE).length / devices.length) * 100;
			alerts.info.push(`Organization device availability: ${onlinePercentage.toFixed(1)}%`);
		}

		return alerts;
	}

	private async generateEveningAlerts(devices: Device[], records: DeviceRecords[]): Promise<DeviceAlerts> {
		const alerts: DeviceAlerts = {
			critical: [],
			warning: [],
			info: [],
		};

		// Critical alerts
		const offlineDevices = devices.filter((d) => d.currentStatus === DeviceStatus.OFFLINE);
		if (offlineDevices.length > 0) {
			alerts.critical.push(`${offlineDevices.length} device(s) went offline during the day`);
		}

		// Warning alerts - get org hours for early closing check
		const orgRef = devices[0]?.orgID ? String(devices[0].orgID) : null;
		const orgHoursArr = orgRef ? await this.organisationHoursService.findAll(orgRef).catch(() => []) : [];
		const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;
		const earlyClosedDevices = records.filter((r) => this.checkEarlyClosing(r.closeTime, orgHours));
		if (earlyClosedDevices.length > 0) {
			alerts.warning.push(`${earlyClosedDevices.length} device(s) closed early today`);
		}

		const stillOpenDevices = records.filter((r) => r.openTime && !r.closeTime);
		if (stillOpenDevices.length > 0) {
			alerts.warning.push(`${stillOpenDevices.length} device(s) are still open after hours`);
		}

		// Info alerts
		const totalWorkingHours = records.reduce((total, record) => {
			if (record.openTime && record.closeTime) {
				const openMs = (record.openTime as unknown as Date).getTime();
				const closeMs = (record.closeTime as unknown as Date).getTime();
				return total + (Math.max(0, closeMs - openMs) / 1000) / 3600;
			}
			return total;
		}, 0);

		if (totalWorkingHours > 0) {
			alerts.info.push(`Total device operational hours today: ${totalWorkingHours.toFixed(1)} hours`);
		}

		return alerts;
	}

	private generateMorningInsights(devices: Device[], records: DeviceRecords[]): DeviceInsights {
		const devicePerformance = devices.map((device) => {
			const deviceRecords = records.filter((r) => r.deviceId === device.id);
			const efficiency = this.calculateDeviceEfficiency(device);

			return {
				id: device.id,
				deviceID: device.deviceID,
				deviceType: device.deviceType,
				location: device.devicLocation,
				currentStatus: device.currentStatus,
				efficiency,
				uptime: device.currentStatus === DeviceStatus.ONLINE ? 100 : 0,
				eventCount: deviceRecords.length,
			};
		});

		return {
			topPerformingDevices: devicePerformance
				.filter((d) => d.efficiency >= 90)
				.sort((a, b) => (b.efficiency || 0) - (a.efficiency || 0))
				.slice(0, 10),
			concerningDevices: devicePerformance
				.filter((d) => (d.efficiency || 0) < 70 || d.currentStatus === DeviceStatus.OFFLINE)
				.sort((a, b) => (a.efficiency || 0) - (b.efficiency || 0))
				.slice(0, 10),
			trendsAnalysis: {
				uptimeImprovement: 0, // Would calculate based on historical data
				efficiencyTrend: 0,
				punctualityTrend: 0,
			},
		};
	}

	private generateEveningInsights(devices: Device[], records: DeviceRecords[]): DeviceInsights {
		return this.generateMorningInsights(devices, records); // Similar logic for evening
	}

	private generateMorningRecommendations(
		devices: Device[],
		records: DeviceRecords[],
		summary: DeviceReportSummary,
	): DeviceRecommendations {
		const recommendations: DeviceRecommendations = {
			immediate: [],
			shortTerm: [],
			longTerm: [],
		};

		// Immediate recommendations
		if (summary.offlineDevices > 0) {
			recommendations.immediate.push(`Check ${summary.offlineDevices} offline device(s) immediately`);
		}

		if (summary.punctualityRate < 80) {
			recommendations.immediate.push('Review device opening schedules and alert thresholds');
		}

		// Short-term recommendations
		if (summary.lateOpenings > 0) {
			recommendations.shortTerm.push('Investigate causes of late device openings');
			recommendations.shortTerm.push('Consider adjusting expected opening times');
		}

		// Long-term recommendations
		if (summary.organizationEfficiency < 85) {
			recommendations.longTerm.push('Implement proactive device monitoring');
			recommendations.longTerm.push('Consider device upgrade or replacement program');
		}

		return recommendations;
	}

	private generateEveningRecommendations(
		devices: Device[],
		records: DeviceRecords[],
		summary: DeviceReportSummary,
	): DeviceRecommendations {
		const recommendations: DeviceRecommendations = {
			immediate: [],
			shortTerm: [],
			longTerm: [],
		};

		// Immediate recommendations
		if (summary.earlyClosings > 0) {
			recommendations.immediate.push(`Investigate ${summary.earlyClosings} device(s) that closed early`);
		}

		const stillOpenDevices = records.filter((r) => r.openTime && !r.closeTime);
		if (stillOpenDevices.length > 0) {
			recommendations.immediate.push(`Ensure ${stillOpenDevices.length} device(s) are properly closed`);
		}

		// Short-term recommendations
		recommendations.shortTerm.push("Prepare tomorrow's device maintenance schedule");
		recommendations.shortTerm.push('Review device performance metrics');

		// Long-term recommendations
		if (summary.averageUptime < 95) {
			recommendations.longTerm.push('Implement device reliability improvement program');
		}

		return recommendations;
	}

	// Helper methods for calculations

	private checkLateOpening(openTime?: Date, orgHours?: any): boolean {
		if (!openTime) return false;
		const orgTimezone = orgHours?.timezone || TimezoneUtil.AFRICA_JOHANNESBURG;
		const [openHour, openMinute] = orgHours?.openTime ? orgHours.openTime.split(':').map(Number) : [8, 0];
		const expectedOpenTime = (openHour * 60 + openMinute) * 60;
		const openDate = new Date(openTime);
		// Use TimezoneUtil to get minutes since midnight in organization timezone
		const openMinutes = TimezoneUtil.getMinutesSinceMidnight(openDate, orgTimezone);
		const actualOpenTime = openMinutes * 60; // Convert to seconds
		const TOLERANCE_SECONDS = 5 * 60;
		// Only consider it late if it's more than 5 minutes after the expected time
		// Early openings are acceptable
		return actualOpenTime > expectedOpenTime + TOLERANCE_SECONDS;
	}

	private checkEarlyClosing(closeTime?: Date, orgHours?: any): boolean {
		if (!closeTime) return false;
		const orgTimezone = orgHours?.timezone || TimezoneUtil.AFRICA_JOHANNESBURG;
		const [closeHour, closeMinute] = orgHours?.closeTime ? orgHours.closeTime.split(':').map(Number) : [17, 0];
		const expectedCloseTime = (closeHour * 60 + closeMinute) * 60;
		const closeDate = new Date(closeTime);
		// Use TimezoneUtil to get minutes since midnight in organization timezone
		const closeMinutes = TimezoneUtil.getMinutesSinceMidnight(closeDate, orgTimezone);
		const actualCloseTime = closeMinutes * 60; // Convert to seconds
		const TOLERANCE_SECONDS = 5 * 60;
		// Only consider it early if it's more than 5 minutes before the expected time
		// Late closings are acceptable
		return actualCloseTime < expectedCloseTime - TOLERANCE_SECONDS;
	}

	private calculateLateMinutes(openTime?: Date, orgHours?: any): number | undefined {
		if (!openTime) return undefined;
		const orgTimezone = orgHours?.timezone || TimezoneUtil.AFRICA_JOHANNESBURG;
		const [openHour, openMinute] = orgHours?.openTime ? orgHours.openTime.split(':').map(Number) : [8, 0];
		const expectedOpenTime = (openHour * 60 + openMinute) * 60;
		const openDate = new Date(openTime);
		// Use TimezoneUtil to get minutes since midnight in organization timezone
		const openMinutes = TimezoneUtil.getMinutesSinceMidnight(openDate, orgTimezone);
		const actualOpenTime = openMinutes * 60; // Convert to seconds
		const diffSeconds = actualOpenTime - expectedOpenTime;
		return diffSeconds > 0 ? Math.round(diffSeconds / 60) : 0;
	}

	private calculateDeviceEfficiency(device: Device): number {
		// Calculate efficiency based on analytics and status
		const analytics = device.analytics;
		if (!analytics || analytics.totalCount === 0) return 100;

		const successRate = (analytics.onTimeCount / analytics.totalCount) * 100;
		const statusPenalty = device.currentStatus === DeviceStatus.ONLINE ? 0 : 20;

		return Math.max(0, successRate - statusPenalty);
	}
}
