import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { CheckIn } from '../entities/check-in.entity';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { OrganisationHours } from '../../organisation/entities/organisation-hours.entity';
import { AccessLevel } from '../../lib/enums/user.enums';
import { CommunicationService } from '../../communication/communication.service';
import { EmailType } from '../../lib/enums/email.enums';
import { PdfGenerationService } from '../../pdf-generation/pdf-generation.service';
import { ConfigService } from '@nestjs/config';
import { format, startOfDay, endOfDay, addMinutes, parse } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { CheckInsDailyReportData } from '../../lib/types/email-templates.types';

export interface ReportSummary {
	totalVisits: number;
	completedVisits: number;
	inProgressVisits: number;
	totalDuration: string;
	averageDuration: string;
	totalSalesValue: number;
	uniqueUsers: number;
	uniqueClients: number;
}

@Injectable()
export class CheckInsReportsService {
	private readonly logger = new Logger(CheckInsReportsService.name);

	constructor(
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(OrganisationHours)
		private organisationHoursRepository: Repository<OrganisationHours>,
		private communicationService: CommunicationService,
		private pdfGenerationService: PdfGenerationService,
		private configService: ConfigService,
	) {}

	/**
	 * Generate and send daily check-ins report for an organization
	 */
	async generateDailyReport(orgId: number, reportDate: Date): Promise<void> {
		const operationId = `REPORT_${orgId}_${Date.now()}`;
		this.logger.log(`[${operationId}] Generating daily check-ins report for org ${orgId} on ${format(reportDate, 'yyyy-MM-dd')}`);

		try {
			// Get organization
			const org = await this.organisationRepository.findOne({
				where: { uid: orgId, isDeleted: false },
			});

			if (!org) {
				this.logger.warn(`[${operationId}] Organization ${orgId} not found`);
				return;
			}

			// Get organization hours for timezone
			const orgHours = await this.organisationHoursRepository.findOne({
				where: { organisationUid: orgId, isDeleted: false },
			});

			const timezone = orgHours?.timezone || 'Africa/Johannesburg';

			// Calculate date range in organization timezone
			const reportDateInTz = toZonedTime(reportDate, timezone);
			const startDate = startOfDay(reportDateInTz);
			const endDate = endOfDay(reportDateInTz);

			// Fetch check-ins for the day
			const checkIns = await this.fetchCheckInsForDateRange(orgId, startDate, endDate);

			if (checkIns.length === 0) {
				this.logger.log(`[${operationId}] No check-ins found for ${format(reportDate, 'yyyy-MM-dd')}`);
				// Still send report with empty data
			}

			// Format data
			const formattedData = this.formatCheckInsForTable(checkIns);
			const summary = this.calculateSummary(checkIns);

			// Find admin users
			const adminUsers = await this.findAdminUsers(orgId);

			if (adminUsers.length === 0) {
				this.logger.warn(`[${operationId}] No admin users found for organization ${orgId}`);
				return;
			}

			// Generate PDF
			const pdfBuffer = await this.generatePDFReport(checkIns, org, summary, reportDate);

			// Prepare email data
			const emailData: CheckInsDailyReportData = {
				organizationName: org.name || 'Organization',
				reportDate: format(reportDate, 'dd MMM yyyy'),
				checkIns: formattedData,
				summary,
				generatedAt: format(new Date(), 'dd MMM yyyy HH:mm'),
				timezone,
			};

			// Send emails to admins
			const adminEmails = adminUsers.map(u => u.email).filter(Boolean);
			if (adminEmails.length > 0) {
				// Send email with PDF attachment
				await this.sendEmailWithAttachment(
					EmailType.CHECK_INS_DAILY_REPORT,
					adminEmails,
					emailData,
					pdfBuffer,
					`check-ins-report-${format(reportDate, 'yyyy-MM-dd')}.pdf`,
				);
				this.logger.log(`[${operationId}] Report sent to ${adminEmails.length} admin(s)`);
			}
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to generate report: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Fetch check-ins for date range
	 */
	private async fetchCheckInsForDateRange(
		orgId: number,
		startDate: Date,
		endDate: Date,
	): Promise<CheckIn[]> {
		return this.checkInRepository.find({
			where: {
				organisationUid: orgId,
				checkInTime: Between(startDate, endDate),
			},
			relations: ['owner', 'client', 'branch'],
			order: {
				checkInTime: 'DESC',
			},
		});
	}

	/**
	 * Format check-ins for table display
	 */
	private formatCheckInsForTable(checkIns: CheckIn[]) {
		return checkIns.map(checkIn => ({
			date: format(new Date(checkIn.checkInTime), 'dd MMM yyyy'),
			user: checkIn.owner
				? `${checkIn.owner.name || ''} ${checkIn.owner.surname || ''}`.trim() || '-'
				: '-',
			branch: checkIn.branch?.name || '-',
			checkInTime: format(new Date(checkIn.checkInTime), 'HH:mm'),
			checkOutTime: checkIn.checkOutTime ? format(new Date(checkIn.checkOutTime), 'HH:mm') : '-',
			duration: checkIn.duration || '-',
			status: checkIn.checkOutTime ? 'Completed' : 'In Progress',
			clientName: checkIn.client?.name || '-',
			contactFullName: checkIn.contactFullName || '-',
			contactCellPhone: checkIn.contactCellPhone || '-',
			contactLandline: checkIn.contactLandline || '-',
			contactEmail: checkIn.contactEmail || '-',
			contactAddress: this.formatAddress(checkIn.contactAddress),
			companyName: checkIn.companyName || '-',
			businessType: checkIn.businessType || '-',
			personSeenPosition: checkIn.personSeenPosition || '-',
			checkInLocation: checkIn.checkInLocation || '-',
			checkOutLocation: checkIn.checkOutLocation || '-',
			salesValue: checkIn.salesValue ? `R ${checkIn.salesValue.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-',
			quotationNumber: checkIn.quotationNumber || '-',
			quotationStatus: checkIn.quotationStatus || '-',
			notes: checkIn.notes || '-',
			resolution: checkIn.resolution || '-',
			followUp: checkIn.followUp || '-',
		}));
	}

	/**
	 * Format address object to string
	 */
	private formatAddress(address: any): string {
		if (!address) return '-';
		if (typeof address === 'string') return address;
		const parts = [
			address.street,
			address.suburb,
			address.city,
			address.state,
			address.postalCode,
			address.country,
		].filter(Boolean);
		return parts.length > 0 ? parts.join(', ') : '-';
	}

	/**
	 * Calculate summary statistics
	 */
	private calculateSummary(checkIns: CheckIn[]): ReportSummary {
		const completedVisits = checkIns.filter(ci => ci.checkOutTime).length;
		const inProgressVisits = checkIns.length - completedVisits;
		
		// Calculate total duration (parse duration strings like "2h 30m")
		let totalMinutes = 0;
		checkIns.forEach(ci => {
			if (ci.duration) {
				const hoursMatch = ci.duration.match(/(\d+)h/);
				const minutesMatch = ci.duration.match(/(\d+)m/);
				const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
				const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
				totalMinutes += hours * 60 + minutes;
			}
		});

		const totalHours = Math.floor(totalMinutes / 60);
		const remainingMinutes = totalMinutes % 60;
		const totalDuration = totalHours > 0 
			? `${totalHours}h ${remainingMinutes}m`
			: `${remainingMinutes}m`;
		
		const averageMinutes = checkIns.length > 0 ? totalMinutes / checkIns.length : 0;
		const avgHours = Math.floor(averageMinutes / 60);
		const avgMins = Math.floor(averageMinutes % 60);
		const averageDuration = avgHours > 0 
			? `${avgHours}h ${avgMins}m`
			: `${avgMins}m`;

		const totalSalesValue = checkIns.reduce((sum, ci) => sum + (ci.salesValue || 0), 0);
		const uniqueUsers = new Set(checkIns.map(ci => ci.ownerClerkUserId).filter(Boolean)).size;
		const uniqueClients = new Set(checkIns.map(ci => ci.client?.uid).filter(Boolean)).size;

		return {
			totalVisits: checkIns.length,
			completedVisits,
			inProgressVisits,
			totalDuration,
			averageDuration,
			totalSalesValue,
			uniqueUsers,
			uniqueClients,
		};
	}

	/**
	 * Find all admin users for an organization
	 */
	private async findAdminUsers(orgId: number): Promise<User[]> {
		return this.userRepository.find({
			where: {
				organisation: { uid: orgId },
				accessLevel: AccessLevel.ADMIN,
				status: 'active',
				isDeleted: false,
			},
			select: ['uid', 'email', 'name', 'surname'],
		});
	}

	/**
	 * Generate PDF report
	 */
	private async generatePDFReport(
		checkIns: CheckIn[],
		org: Organisation,
		summary: ReportSummary,
		reportDate: Date,
	): Promise<Buffer> {
		const pdfData = {
			organizationName: org.name || 'Organization',
			reportDate: format(reportDate, 'dd MMM yyyy'),
			checkIns: this.formatCheckInsForTable(checkIns),
			summary,
			generatedAt: format(new Date(), 'dd MMM yyyy HH:mm'),
		};

		// Generate PDF using the service's internal method
		// Access the private method via bracket notation
		const pdfBuffer = await (this.pdfGenerationService as any).generatePdfFromTemplate('check-ins-report', pdfData);
		return pdfBuffer;
	}

	/**
	 * Send email with PDF attachment using nodemailer directly
	 */
	private async sendEmailWithAttachment(
		emailType: EmailType,
		recipients: string[],
		data: CheckInsDailyReportData,
		pdfBuffer: Buffer,
		filename: string,
	): Promise<void> {
		const template = this.communicationService['getEmailTemplate'](emailType, data);
		
		// Use nodemailer directly to send with attachment
		const nodemailer = require('nodemailer');
		
		const transporter = nodemailer.createTransport({
			host: this.configService.get<string>('SMTP_HOST'),
			port: this.configService.get<number>('SMTP_PORT'),
			secure: this.configService.get<number>('SMTP_PORT') === 465,
			auth: {
				user: this.configService.get<string>('SMTP_USER'),
				pass: this.configService.get<string>('SMTP_PASS'),
			},
			tls: {
				rejectUnauthorized: false,
			},
		});

		const emailFrom = this.configService.get<string>('SMTP_FROM');
		const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME');
		const fromField = emailFromName ? `"${emailFromName}" <${emailFrom}>` : emailFrom;

		await transporter.sendMail({
			from: fromField,
			to: recipients,
			subject: template.subject,
			html: template.body,
			attachments: [
				{
					filename,
					content: pdfBuffer,
					contentType: 'application/pdf',
				},
			],
		});
	}
}
