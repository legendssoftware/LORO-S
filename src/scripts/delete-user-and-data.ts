#!/usr/bin/env node

/**
 * Delete a user and all their linked data by clerkUserId.
 * Runs in a single transaction; supports --dry-run to log without committing.
 *
 * Usage:
 *   npm run delete-user-and-data
 *   npm run delete-user-and-data -- user_38XXXXXX
 *   npm run delete-user-and-data -- --dry-run user_38XXXXXX
 *   npm run delete-user-and-data -- --clerk-user-id=user_39pUkiPkCzDO2AlM4OKlQlVgDhV
 */

import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../user/entities/user.entity';
import { UserProfile } from '../user/entities/user.profile.entity';
import { UserEmployeementProfile } from '../user/entities/user.employeement.profile.entity';
import { UserTarget } from '../user/entities/user-target.entity';
import { Attendance } from '../attendance/entities/attendance.entity';
import { Report } from '../reports/entities/report.entity';
import { Claim } from '../claims/entities/claim.entity';
import { Doc } from '../docs/entities/doc.entity';
import { Lead } from '../leads/entities/lead.entity';
import { News } from '../news/entities/news.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Tracking } from '../tracking/entities/tracking.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { UserRewards } from '../rewards/entities/user-rewards.entity';
import { Achievement } from '../rewards/entities/achievement.entity';
import { UnlockedItem } from '../rewards/entities/unlocked-item.entity';
import { XPTransaction } from '../rewards/entities/xp-transaction.entity';
import { Journal } from '../journal/entities/journal.entity';
import { Task } from '../tasks/entities/task.entity';
import { Route } from '../tasks/entities/route.entity';
import { TaskFlag } from '../tasks/entities/task-flag.entity';
import { TaskFlagItem } from '../tasks/entities/task-flag-item.entity';
import { Warning } from '../warnings/entities/warning.entity';
import { ClientCommunicationSchedule } from '../clients/entities/client-communication-schedule.entity';
import { Project } from '../shop/entities/project.entity';
import { Leave } from '../leave/entities/leave.entity';
import { Interaction } from '../interactions/entities/interaction.entity';
import { Approval } from '../approvals/entities/approval.entity';
import { ApprovalSignature } from '../approvals/entities/approval-signature.entity';
import { ApprovalHistory } from '../approvals/entities/approval-history.entity';
import { GeofenceEvent } from '../tracking/entities/geofence-event.entity';
import { Client } from '../clients/entities/client.entity';

const DEFAULT_CLERK_USER_ID = 'user_39pUkiPkCzDO2AlM4OKlQlVgDhV';

function parseArgs(): { clerkUserId: string; dryRun: boolean } {
	let clerkUserId = DEFAULT_CLERK_USER_ID;
	let dryRun = false;
	const args = process.argv.slice(2);
	for (const arg of args) {
		if (arg === '--dry-run') dryRun = true;
		else if (arg.startsWith('--clerk-user-id=')) clerkUserId = arg.slice('--clerk-user-id='.length).trim();
		else if (!arg.startsWith('--') && arg.length > 0) clerkUserId = arg.trim();
	}
	return { clerkUserId, dryRun };
}

async function main() {
	const { clerkUserId, dryRun } = parseArgs();

	console.log('Delete user and linked data');
	console.log('  clerkUserId:', clerkUserId);
	console.log('  dryRun:', dryRun);
	console.log('');

	const app = await NestFactory.createApplicationContext(AppModule);
	const dataSource = app.get(DataSource);
	const qr = dataSource.createQueryRunner();
	await qr.connect();
	await qr.startTransaction();

	try {
		const user = await qr.manager.findOne(User, { where: { clerkUserId } });
		if (!user) {
			console.log('User not found. Rolling back.');
			await qr.rollbackTransaction();
			await qr.release();
			await app.close();
			process.exit(1);
		}
		const userId = user.uid;
		console.log('Found user uid:', userId);

		const log = (msg: string, result: { affected?: number }) => {
			const n = result?.affected ?? 0;
			console.log(`  ${msg}: ${n}`);
		};

		// --- SET NULL (optional FKs where this user is verifier/approver/assignee) ---
		log('client.assignedSalesRepUid', await qr.manager.update(Client, { assignedSalesRepUid: userId }, { assignedSalesRepUid: null as any }));
		log('project.assignedUserClerkUserId', await qr.manager.update(Project, { assignedUserClerkUserId: clerkUserId }, { assignedUserClerkUserId: null as any }));
		log('leave.approvedByClerkUserId', await qr.manager.update(Leave, { approvedByClerkUserId: clerkUserId }, { approvedByClerkUserId: null as any }));
		log('claim.verifiedByClerkUserId', await qr.manager.update(Claim, { verifiedByClerkUserId: clerkUserId }, { verifiedByClerkUserId: null as any }));
		log('attendance.verifiedByClerkUserId', await qr.manager.update(Attendance, { verifiedByClerkUserId: clerkUserId }, { verifiedByClerkUserId: null as any }));
		log('warnings.issuedByClerkUserId', await qr.manager.update(Warning, { issuedByClerkUserId: clerkUserId }, { issuedByClerkUserId: null as any }));
		// Geofence createdById/updatedById/deletedById are integer (FK to users.uid) in DB
		const geofenceCreated = await qr.query('UPDATE geofences SET "createdById" = NULL WHERE "createdById" = $1', [userId]) as { rowCount?: number };
		log('geofences.createdById', { affected: geofenceCreated?.rowCount ?? 0 });
		const geofenceUpdated = await qr.query('UPDATE geofences SET "updatedById" = NULL WHERE "updatedById" = $1', [userId]) as { rowCount?: number };
		log('geofences.updatedById', { affected: geofenceUpdated?.rowCount ?? 0 });
		const geofenceDeleted = await qr.query('UPDATE geofences SET "deletedById" = NULL WHERE "deletedById" = $1', [userId]) as { rowCount?: number };
		log('geofences.deletedById', { affected: geofenceDeleted?.rowCount ?? 0 });
		log('approvals.approverClerkUserId', await qr.manager.update(Approval, { approverClerkUserId: clerkUserId }, { approverClerkUserId: null as any }));
		log('approvals.delegatedFromClerkUserId', await qr.manager.update(Approval, { delegatedFromClerkUserId: clerkUserId }, { delegatedFromClerkUserId: null as any }));
		const competitorResult = await qr.query('UPDATE competitor SET "createdByUid" = NULL WHERE "createdByUid" = $1', [userId]) as { rowCount?: number };
		log('competitor.createdByUid', { affected: competitorResult?.rowCount ?? 0 });
		log('quotation.resellerClerkUserId', await qr.manager.update(Quotation, { resellerClerkUserId: clerkUserId }, { resellerClerkUserId: null as any }));

		// --- DELETE: approval_signatures, approval_history, then approvals (requester) ---
		log('approval_signatures.signerClerkUserId', await qr.manager.delete(ApprovalSignature, { signerClerkUserId: clerkUserId }));
		log('approval_history.actionByClerkUserId', await qr.manager.delete(ApprovalHistory, { actionByClerkUserId: clerkUserId }));
		log('approvals.requesterClerkUserId', await qr.manager.delete(Approval, { requesterClerkUserId: clerkUserId }));

		// --- Rewards: delete achievement, unlocked_item, xp_transaction where user_rewards.ownerClerkUserId = user, then user_rewards ---
		const userRewardsRow = await qr.manager.findOne(UserRewards, { where: { ownerClerkUserId: clerkUserId } });
		if (userRewardsRow) {
			const urUid = userRewardsRow.uid;
			log('achievement (via user_rewards)', await qr.manager.delete(Achievement, { userRewards: { uid: urUid } }));
			log('unlocked_item (via user_rewards)', await qr.manager.delete(UnlockedItem, { userRewards: { uid: urUid } }));
			log('xp_transaction (via user_rewards)', await qr.manager.delete(XPTransaction, { userRewards: { uid: urUid } }));
			log('user_rewards', await qr.manager.delete(UserRewards, { ownerClerkUserId: clerkUserId }));
		}

		// --- Tasks: task_flag_items for task_flags of tasks created by user, then task_flags for those tasks, then tasks, then task_flags where createdBy = user ---
		const tasksCreatedByUser = await qr.manager.find(Task, { where: { creatorClerkUserId: clerkUserId }, select: ['uid'] });
		const taskUids = tasksCreatedByUser.map((t) => t.uid);
		if (taskUids.length > 0) {
			const taskFlagsOnThoseTasks = await qr.manager.find(TaskFlag, { where: { task: { uid: In(taskUids) } }, select: ['uid'] });
			const taskFlagUids = taskFlagsOnThoseTasks.map((f) => f.uid);
			if (taskFlagUids.length > 0) {
				log('task_flag_items (for task_flags of deleted tasks)', await qr.manager.delete(TaskFlagItem, { taskFlag: { uid: In(taskFlagUids) } }));
			}
			log('task_flags (for deleted tasks)', await qr.manager.delete(TaskFlag, { task: { uid: In(taskUids) } }));
		}
		log('tasks.creatorClerkUserId', await qr.manager.delete(Task, { creatorClerkUserId: clerkUserId }));
		log('task_flags.createdByClerkUserId', await qr.manager.delete(TaskFlag, { createdByClerkUserId: clerkUserId }));

		// --- DELETE owned/created rows (clerkUserId) ---
		log('attendance.ownerClerkUserId', await qr.manager.delete(Attendance, { ownerClerkUserId: clerkUserId }));
		log('reports.ownerClerkUserId', await qr.manager.delete(Report, { ownerClerkUserId: clerkUserId }));
		log('claim.ownerClerkUserId', await qr.manager.delete(Claim, { ownerClerkUserId: clerkUserId }));
		log('docs.ownerClerkUserId', await qr.manager.delete(Doc, { ownerClerkUserId: clerkUserId }));
		log('leads.ownerClerkUserId', await qr.manager.delete(Lead, { ownerClerkUserId: clerkUserId }));
		log('news.authorClerkUserId', await qr.manager.delete(News, { authorClerkUserId: clerkUserId }));
		log('asset.ownerClerkUserId', await qr.manager.delete(Asset, { ownerClerkUserId: clerkUserId }));
		log('tracking.ownerClerkUserId', await qr.manager.delete(Tracking, { ownerClerkUserId: clerkUserId }));
		log('notification.ownerClerkUserId', await qr.manager.delete(Notification, { ownerClerkUserId: clerkUserId }));
		log('check_ins.ownerClerkUserId', await qr.manager.delete(CheckIn, { ownerClerkUserId: clerkUserId }));
		log('journal.ownerClerkUserId', await qr.manager.delete(Journal, { ownerClerkUserId: clerkUserId }));
		log('routes.assigneeClerkUserId', await qr.manager.delete(Route, { assigneeClerkUserId: clerkUserId }));
		log('warnings.ownerClerkUserId', await qr.manager.delete(Warning, { ownerClerkUserId: clerkUserId }));
		log('client_communication_schedules.assignedToClerkUserId', await qr.manager.delete(ClientCommunicationSchedule, { assignedToClerkUserId: clerkUserId }));
		log('leave.ownerClerkUserId', await qr.manager.delete(Leave, { ownerClerkUserId: clerkUserId }));
		log('interactions.createdByClerkUserId', await qr.manager.delete(Interaction, { createdByClerkUserId: clerkUserId }));
		log('quotation.placedByClerkUserId', await qr.manager.delete(Quotation, { placedByClerkUserId: clerkUserId }));
		log('geofence_events.userId', await qr.manager.delete(GeofenceEvent, { userId: clerkUserId }));

		// --- usage_summaries, usage_events, license_audit (by user.uid; raw - entities may not be in root TypeORM config) ---
		const usageSummaryResult = await qr.query('DELETE FROM usage_summaries WHERE user_id = $1', [userId]) as { rowCount?: number };
		log('usage_summaries.user_id', { affected: usageSummaryResult?.rowCount ?? 0 });
		const usageEventResult = await qr.query('DELETE FROM usage_events WHERE user_id = $1', [userId]) as { rowCount?: number };
		log('usage_events.user_id', { affected: usageEventResult?.rowCount ?? 0 });
		const licenseAuditResult = await qr.query('DELETE FROM license_audit WHERE "userId" = $1', [userId]) as { rowCount?: number };
		log('license_audit.userId', { affected: licenseAuditResult?.rowCount ?? 0 });

		// --- user_profile, user_employeement_profile, user_targets, users ---
		log('user_profile', await qr.manager.delete(UserProfile, { ownerClerkUserId: clerkUserId }));
		log('user_employeement_profile', await qr.manager.delete(UserEmployeementProfile, { ownerClerkUserId: clerkUserId }));
		log('user_targets', await qr.manager.delete(UserTarget, { userClerkUserId: clerkUserId }));
		log('users', await qr.manager.delete(User, { clerkUserId }));

		if (dryRun) {
			console.log('\nDry run: rolling back (no changes committed).');
			await qr.rollbackTransaction();
		} else {
			await qr.commitTransaction();
			console.log('\nCommitted.');
		}
	} catch (err) {
		console.error('Error:', err);
		try {
			await qr.rollbackTransaction();
		} finally {
			await qr.release();
		}
		try {
			await app.close();
		} catch {
			// Ignore shutdown errors (e.g. DataSource not in context) so original error is visible
		}
		process.exit(1);
	}

	await qr.release();
	await app.close();
}

main();
