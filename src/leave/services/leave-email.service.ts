import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '../../user/entities/user.entity';
import { Leave } from '../entities/leave.entity';
import { AccessLevel } from '../../lib/enums/user.enums';
import { EmailType } from '../../lib/enums/email.enums';
import {
	LeaveApplicationConfirmationData,
	LeaveNewApplicationAdminData,
	LeaveStatusUpdateUserData,
	LeaveStatusUpdateAdminData,
	LeaveDeletedNotificationData,
} from '../../lib/types/email-templates.types';

@Injectable()
export class LeaveEmailService {
	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@Inject('EmailTemplateService')
		private readonly emailTemplateService: any,
		private readonly eventEmitter: EventEmitter2,
	) {}

	/**
	 * Find all HR, Manager, and Admin users in the same organization as the applicant
	 * Implements enhanced role targeting for leave request approval workflows
	 */
	private async findApprovalUsers(orgId: number, branchId?: number): Promise<User[]> {
		const whereClause: any = {
			accessLevel: In([
				AccessLevel.HR,
				AccessLevel.MANAGER, 
				AccessLevel.ADMIN,
				AccessLevel.OWNER
			]),
			status: 'active',
			isDeleted: false,
		};

		// Add organization filter
		if (orgId) {
			whereClause.organisation = { uid: orgId };
		}

		// Optionally filter by branch if provided
		if (branchId) {
			whereClause.branch = { uid: branchId };
		}

		const users = await this.userRepository.find({
			where: whereClause,
			relations: ['organisation', 'branch'],
			order: {
				accessLevel: 'DESC', // Prioritize by access level (OWNER > ADMIN > MANAGER > HR)
			},
		});

		// Remove duplicates if a user has multiple qualifying roles
		const uniqueUsers = users.filter((user, index, self) => 
			index === self.findIndex(u => u.uid === user.uid)
		);

		return uniqueUsers;
	}

	/**
	 * @deprecated Use findApprovalUsers instead for enhanced role targeting
	 * Find all admin users in the same organization as the applicant
	 */
	private async findAdminUsers(orgId: number, branchId?: number): Promise<User[]> {
		return this.findApprovalUsers(orgId, branchId);
	}

	/**
	 * Get delegated user information if delegation is set up
	 */
	private async getDelegatedUser(delegatedToUid?: number): Promise<User | null> {
		if (!delegatedToUid) return null;

		return this.userRepository.findOne({
			where: { uid: delegatedToUid },
			relations: ['organisation', 'branch'],
		});
	}

	/**
	 * Send leave application confirmation email to the applicant
	 */
	async sendApplicationConfirmation(leave: Leave, applicant: User): Promise<void> {
		try {
			const delegatedUser = await this.getDelegatedUser(leave.delegatedToUid);

			const emailData: LeaveApplicationConfirmationData = {
				name: applicant.name || applicant.email,
				applicantName: applicant.name || applicant.email,
				leaveId: leave.uid,
				leaveType: leave.leaveType,
				startDate: leave.startDate.toString(),
				endDate: leave.endDate.toString(),
				duration: leave.duration,
				status: leave.status,
				isHalfDay: leave.isHalfDay,
				halfDayPeriod: leave.halfDayPeriod,
				motivation: leave.motivation,
				tags: leave.tags,
				isPaid: leave.isPaid,
				paidAmount: leave.paidAmount,
				isDelegated: !!leave.delegatedToUid,
				delegatedToName: delegatedUser?.name,
				isPublicHoliday: leave.isPublicHoliday,
				createdAt: leave.createdAt.toISOString(),
			};

			// Emit email event
			this.eventEmitter.emit('send.email', EmailType.LEAVE_APPLICATION_CONFIRMATION, [applicant.email], emailData);
		} catch (error) {
			console.error('Error sending leave application confirmation email:', error);
		}
	}

	/**
	 * Send new leave application notification to admins
	 */
	async sendNewApplicationAdminNotification(leave: Leave, applicant: User): Promise<void> {
		try {
			const admins = await this.findAdminUsers(
				leave.organisation?.uid || applicant.organisation?.uid,
				leave.branch?.uid || applicant.branch?.uid,
			);

			if (admins.length === 0) {
				console.warn(
					`No admin users found for organization ${leave.organisation?.uid || applicant.organisation?.uid}`,
				);
				return;
			}

			const delegatedUser = await this.getDelegatedUser(leave.delegatedToUid);

			for (const approver of admins) {
				const emailData: LeaveNewApplicationAdminData = {
					name: approver.name || approver.email,
					adminName: approver.name || approver.email,
					applicantName: applicant.name || applicant.email,
					applicantEmail: applicant.email,
					applicantDepartment: applicant.departmentId?.toString() || 'Not specified',
					branchName: leave.branch?.name || applicant.branch?.name || 'Main Branch',
					leaveId: leave.uid,
					leaveType: leave.leaveType,
					startDate: leave.startDate.toString(),
					endDate: leave.endDate.toString(),
					duration: leave.duration,
					isHalfDay: leave.isHalfDay,
					halfDayPeriod: leave.halfDayPeriod,
					motivation: leave.motivation,
					tags: leave.tags,
					isPaid: leave.isPaid,
					paidAmount: leave.paidAmount,
					isDelegated: !!leave.delegatedToUid,
					delegatedToName: delegatedUser?.name,
					isPublicHoliday: leave.isPublicHoliday,
					attachments: leave.attachments,
					createdAt: leave.createdAt.toISOString(),
				};

				// Emit email event
				this.eventEmitter.emit('send.email', EmailType.LEAVE_NEW_APPLICATION_ADMIN, [approver.email], emailData);
			}
		} catch (error) {
			console.error('Error sending new leave application admin notification:', error);
		}
	}

	/**
	 * Send leave status update to the user
	 */
	async sendStatusUpdateToUser(
		leave: Leave,
		applicant: User,
		previousStatus: string,
		processedBy?: User,
	): Promise<void> {
		try {
			// Calculate return date (day after end date)
			const returnDate = new Date(leave.endDate);
			returnDate.setDate(returnDate.getDate() + 1);

			const emailData: LeaveStatusUpdateUserData = {
				name: applicant.name || applicant.email,
				applicantName: applicant.name || applicant.email,
				leaveId: leave.uid,
				leaveType: leave.leaveType,
				startDate: leave.startDate.toString(),
				endDate: leave.endDate.toString(),
				duration: leave.duration,
				status: leave.status,
				processedBy: processedBy?.name || processedBy?.email,
				processedAt:
					leave.approvedAt?.toISOString() ||
					leave.rejectedAt?.toISOString() ||
					leave.cancelledAt?.toISOString(),
				comments: leave.comments,
				rejectionReason: leave.rejectionReason,
				cancellationReason: leave.cancellationReason,
				isDelegated: !!leave.delegatedToUid,
				returnDate: returnDate.toISOString(),
				createdAt: leave.createdAt.toISOString(),
			};

			// Emit email event
			this.eventEmitter.emit('send.email', EmailType.LEAVE_STATUS_UPDATE_USER, [applicant.email], emailData);
		} catch (error) {
			console.error('Error sending leave status update to user:', error);
		}
	}

	/**
	 * Send leave status update to admins
	 */
	async sendStatusUpdateToAdmins(
		leave: Leave,
		applicant: User,
		previousStatus: string,
		processedBy?: User,
	): Promise<void> {
		try {
			const admins = await this.findAdminUsers(
				leave.organisation?.uid || applicant.organisation?.uid,
				leave.branch?.uid || applicant.branch?.uid,
			);

			if (admins.length === 0) {
				console.warn(
					`No admin users found for organization ${leave.organisation?.uid || applicant.organisation?.uid}`,
				);
				return;
			}

			// Calculate return date (day after end date)
			const returnDate = new Date(leave.endDate);
			returnDate.setDate(returnDate.getDate() + 1);

			// Get some basic metrics (you can expand this with actual queries)
			const pendingCount = 0; // TODO: Implement actual count
			const monthlyApprovals = 0; // TODO: Implement actual count
			const adequateCoverage = true; // TODO: Implement actual logic

			for (const approver of admins) {
				const emailData: LeaveStatusUpdateAdminData = {
					name: approver.name || approver.email,
					adminName: approver.name || approver.email,
					applicantName: applicant.name || applicant.email,
					applicantEmail: applicant.email,
					applicantDepartment: applicant.departmentId?.toString() || 'Not specified',
					branchName: leave.branch?.name || applicant.branch?.name || 'Main Branch',
					leaveId: leave.uid,
					leaveType: leave.leaveType,
					startDate: leave.startDate.toString(),
					endDate: leave.endDate.toString(),
					duration: leave.duration,
					status: leave.status,
					previousStatus,
					actionTakenBy: processedBy?.name || processedBy?.email,
					updateTime: new Date().toISOString(),
					comments: leave.comments,
					rejectionReason: leave.rejectionReason,
					cancellationReason: leave.cancellationReason,
					isDelegated: !!leave.delegatedToUid,
					returnDate: returnDate.toISOString(),
					createdAt: leave.createdAt.toISOString(),
					pendingCount,
					monthlyApprovals,
					adequateCoverage,
					upcomingLeaves: [], // TODO: Implement actual upcoming leaves query
				};

				// Emit email event
				this.eventEmitter.emit('send.email', EmailType.LEAVE_STATUS_UPDATE_ADMIN, [approver.email], emailData);
			}
		} catch (error) {
			console.error('Error sending leave status update to admins:', error);
		}
	}

	/**
	 * Send leave deletion notification
	 */
	async sendDeletedNotification(
		leave: Leave,
		applicant: User,
		deletedBy?: User,
		deletionReason?: string,
	): Promise<void> {
		try {
			const admins = await this.findAdminUsers(
				leave.organisation?.uid || applicant.organisation?.uid,
				leave.branch?.uid || applicant.branch?.uid,
			);

			// Send to applicant
			const applicantEmailData: LeaveDeletedNotificationData = {
				name: applicant.name || applicant.email,
				recipientName: applicant.name || applicant.email,
				isApplicant: true,
				applicantName: applicant.name || applicant.email,
				applicantEmail: applicant.email,
				leaveId: leave.uid,
				leaveType: leave.leaveType,
				startDate: leave.startDate.toString(),
				endDate: leave.endDate.toString(),
				duration: leave.duration,
				statusWhenDeleted: leave.status,
				deletedAt: new Date().toISOString(),
				deletedBy: deletedBy?.name || deletedBy?.email,
				motivation: leave.motivation,
				deletionReason,
				createdAt: leave.createdAt.toISOString(),
			};

			// Emit email event for applicant
			this.eventEmitter.emit('send.email', EmailType.LEAVE_DELETED_NOTIFICATION, [applicant.email], applicantEmailData);

			// Send to approvers
			for (const approver of admins) {
				const approverEmailData: LeaveDeletedNotificationData = {
					name: approver.name || approver.email,
					recipientName: approver.name || approver.email,
					isApplicant: false,
					applicantName: applicant.name || applicant.email,
					applicantEmail: applicant.email,
					leaveId: leave.uid,
					leaveType: leave.leaveType,
					startDate: leave.startDate.toString(),
					endDate: leave.endDate.toString(),
					duration: leave.duration,
					statusWhenDeleted: leave.status,
					deletedAt: new Date().toISOString(),
					deletedBy: deletedBy?.name || deletedBy?.email,
					motivation: leave.motivation,
					deletionReason,
					createdAt: leave.createdAt.toISOString(),
					remainingPendingCount: 0, // TODO: Implement actual count
					adequateCoverage: true, // TODO: Implement actual logic
				};

				// Emit email event for approver
				this.eventEmitter.emit('send.email', EmailType.LEAVE_DELETED_NOTIFICATION, [approver.email], approverEmailData);
			}
		} catch (error) {
			console.error('Error sending leave deletion notification:', error);
		}
	}
}
