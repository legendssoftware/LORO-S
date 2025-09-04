import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan, LessThan, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Device, DeviceRecords } from '../entities/iot.entity';
import { DeviceStatus, DeviceType } from '../../lib/enums/iot';
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
		private readonly configService: ConfigService,
		private readonly eventEmitter: EventEmitter2,
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
			const alerts = this.generateMorningAlerts(devices, todayRecords);
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
			const alerts = this.generateEveningAlerts(devices, todayRecords);
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

			// Expected times (can be configurable per device)
			const expectedOpenTime = 8 * 3600; // 8:00 AM in seconds
			const expectedCloseTime = 17 * 3600; // 5:00 PM in seconds

			let onTimeOpenings = 0;
			let lateOpenings = 0;
			let onTimeClosings = 0;
			let earlyClosings = 0;
			let totalEvents = 0;
			let totalUptime = 0;

			for (const record of records) {
				totalEvents++;

				if (record.openTime) {
					const openHour = new Date(record.openTime * 1000).getHours() * 3600;
					const openMinute = new Date(record.openTime * 1000).getMinutes() * 60;
					const actualOpenTime = openHour + openMinute;

					if (actualOpenTime <= expectedOpenTime + 15 * 60) {
						// 15 minutes tolerance
						onTimeOpenings++;
					} else {
						lateOpenings++;
					}
				}

				if (record.closeTime) {
					const closeHour = new Date(record.closeTime * 1000).getHours() * 3600;
					const closeMinute = new Date(record.closeTime * 1000).getMinutes() * 60;
					const actualCloseTime = closeHour + closeMinute;

					if (actualCloseTime >= expectedCloseTime - 15 * 60) {
						// 15 minutes tolerance
						onTimeClosings++;
					} else {
						earlyClosings++;
					}
				}

				// Calculate uptime for this record
				if (record.openTime && record.closeTime) {
					totalUptime += record.closeTime - record.openTime;
				}
			}

			const openTimePunctuality = totalEvents > 0 ? (onTimeOpenings / totalEvents) * 100 : 0;
			const closeTimePunctuality = totalEvents > 0 ? (onTimeClosings / totalEvents) * 100 : 0;
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
				recipients: ['admin@orrbit.co.za', 'owner@orrbit.co.za'], // Can be made configurable
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
		const expectedOpenTime = 8 * 3600; // 8:00 AM
		const lateOpenings = records.filter((r) => {
			if (!r.openTime) return false;
			const openHour = new Date(r.openTime * 1000).getHours() * 3600;
			const openMinute = new Date(r.openTime * 1000).getMinutes() * 60;
			return openHour + openMinute > expectedOpenTime + 15 * 60; // 15 min tolerance
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
		const expectedCloseTime = 17 * 3600; // 5:00 PM
		const earlyClosings = records.filter((r) => {
			if (!r.closeTime) return false;
			const closeHour = new Date(r.closeTime * 1000).getHours() * 3600;
			const closeMinute = new Date(r.closeTime * 1000).getMinutes() * 60;
			return closeHour + closeMinute < expectedCloseTime - 15 * 60; // 15 min tolerance
		}).length;

		const totalWorkingHours = records.reduce((total, record) => {
			if (record.openTime && record.closeTime) {
				return total + (record.closeTime - record.openTime) / 3600;
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
						? new Date(latestRecord.openTime * 1000).toISOString()
						: undefined,
					lastCloseTime: latestRecord?.closeTime
						? new Date(latestRecord.closeTime * 1000).toISOString()
						: undefined,
					todayOpenTime: todayRecord?.openTime
						? new Date(todayRecord.openTime * 1000).toISOString()
						: undefined,
					todayCloseTime: todayRecord?.closeTime
						? new Date(todayRecord.closeTime * 1000).toISOString()
						: undefined,
					isLateOpening: this.checkLateOpening(todayRecord?.openTime),
					isEarlyClosing: this.checkEarlyClosing(todayRecord?.closeTime),
					lateMinutes: this.calculateLateMinutes(todayRecord?.openTime),
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

	private generateMorningAlerts(devices: Device[], records: DeviceRecords[]): DeviceAlerts {
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

		const lateDevices = records.filter((r) => this.checkLateOpening(r.openTime));
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

	private generateEveningAlerts(devices: Device[], records: DeviceRecords[]): DeviceAlerts {
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

		// Warning alerts
		const earlyClosedDevices = records.filter((r) => this.checkEarlyClosing(r.closeTime));
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
				return total + (record.closeTime - record.openTime) / 3600;
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

	private checkLateOpening(openTime?: number): boolean {
		if (!openTime) return false;
		const expectedOpenTime = 8 * 3600; // 8:00 AM
		const actualOpenTime =
			new Date(openTime * 1000).getHours() * 3600 + new Date(openTime * 1000).getMinutes() * 60;
		return actualOpenTime > expectedOpenTime + 15 * 60; // 15 minutes tolerance
	}

	private checkEarlyClosing(closeTime?: number): boolean {
		if (!closeTime) return false;
		const expectedCloseTime = 17 * 3600; // 5:00 PM
		const actualCloseTime =
			new Date(closeTime * 1000).getHours() * 3600 + new Date(closeTime * 1000).getMinutes() * 60;
		return actualCloseTime < expectedCloseTime - 15 * 60; // 15 minutes tolerance
	}

	private calculateLateMinutes(openTime?: number): number | undefined {
		if (!openTime) return undefined;
		const expectedOpenTime = 8 * 3600; // 8:00 AM
		const actualOpenTime =
			new Date(openTime * 1000).getHours() * 3600 + new Date(openTime * 1000).getMinutes() * 60;
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
