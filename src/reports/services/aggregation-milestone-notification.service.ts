import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { ExpoPushService, ExpoPushMessage } from '../../lib/services/expo-push.service';
import { AccessLevel } from '../../lib/enums/user.enums';
import { AccountStatus } from '../../lib/enums/status.enums';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

/**
 * Milestones: 500K, 1M, 1.5M, 2M, 2.5M, 3M, 3.5M, 4M (transactions).
 * Notify org admins via push when aggregation crosses each milestone.
 * Message does not include the actual value (e.g. "We have crossed 500K").
 */
const AGGREGATION_MILESTONES = [
	500_000,
	1_000_000,
	1_500_000,
	2_000_000,
	2_500_000,
	3_000_000,
	3_500_000,
	4_000_000,
] as const;

const MILESTONE_LABELS: Record<number, string> = {
	500_000: '500K',
	1_000_000: '1M',
	1_500_000: '1.5M',
	2_000_000: '2M',
	2_500_000: '2.5M',
	3_000_000: '3M',
	3_500_000: '3.5M',
	4_000_000: '4M',
};

const CACHE_KEY_PREFIX = 'aggregation_milestone:org:';
const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

@Injectable()
export class AggregationMilestoneNotificationService {
	private readonly logger = new Logger(AggregationMilestoneNotificationService.name);

	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private readonly organisationRepository: Repository<Organisation>,
		private readonly expoPushService: ExpoPushService,
		@Inject(CACHE_MANAGER)
		private readonly cacheManager: Cache,
	) {}

	/**
	 * Get the last milestone we already notified for this org (from cache).
	 */
	async getLastNotifiedMilestone(organisationId: number): Promise<number | null> {
		const key = `${CACHE_KEY_PREFIX}${organisationId}`;
		const value = await this.cacheManager.get<number>(key);
		return value ?? null;
	}

	/**
	 * Persist the last notified milestone for this org (cache).
	 */
	async setLastNotifiedMilestone(organisationId: number, milestone: number): Promise<void> {
		const key = `${CACHE_KEY_PREFIX}${organisationId}`;
		await this.cacheManager.set(key, milestone, CACHE_TTL_MS);
		this.logger.log(`[AggregationMilestone] Org ${organisationId}: last notified milestone set to ${milestone}`);
	}

	/**
	 * Get admin users (ADMIN or OWNER) for the organisation who have a valid push token.
	 */
	async getAdminsWithPushTokens(organisationId: number): Promise<User[]> {
		const org = await this.organisationRepository.findOne({
			where: { uid: organisationId },
			select: ['uid'],
		});
		if (!org) {
			this.logger.warn(`[AggregationMilestone] Organisation not found: ${organisationId}`);
			return [];
		}

		const admins = await this.userRepository.find({
			where: {
				organisation: { uid: org.uid },
				accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER]),
				isDeleted: false,
				status: AccountStatus.ACTIVE,
			},
			select: ['uid', 'name', 'surname', 'email', 'expoPushToken', 'preferences'],
		});

		// Gate by user preference: only send push when user has consented (preferences.notifications !== false)
		const withTokens = admins.filter(
			(u) =>
				u.preferences?.notifications !== false &&
				u.expoPushToken &&
				this.expoPushService.isValidExpoPushToken(u.expoPushToken),
		);
		if (withTokens.length === 0) {
			this.logger.warn(`[AggregationMilestone] No org admins with valid push tokens for org ${organisationId}`);
		}
		return withTokens;
	}

	/**
	 * Check current transaction count against milestones and send push to admins when a new milestone is crossed.
	 * Does not include the actual value in the message (e.g. "We have crossed 500K").
	 */
	async checkAndNotifyMilestones(organisationId: number, currentTransactionCount: number): Promise<void> {
		if (currentTransactionCount < AGGREGATION_MILESTONES[0]) {
			return;
		}

		const lastNotified = await this.getLastNotifiedMilestone(organisationId);
		const crossed = AGGREGATION_MILESTONES.filter((m) => currentTransactionCount >= m && (lastNotified === null || m > lastNotified));
		if (crossed.length === 0) {
			return;
		}

		// Notify for the highest newly crossed milestone only (one push per check)
		const milestoneToNotify = Math.max(...crossed);
		const label = MILESTONE_LABELS[milestoneToNotify] ?? String(milestoneToNotify / 1_000_000) + 'M';

		const admins = await this.getAdminsWithPushTokens(organisationId);
		if (admins.length === 0) {
			return;
		}

		const title = 'Aggregation milestone';
		const body = `We have crossed ${label}.`;
		const messages: ExpoPushMessage[] = admins
			.filter((u) => u.expoPushToken)
			.map((u) => ({
				to: u.expoPushToken!,
				title,
				body,
				data: {
					type: 'aggregation_milestone',
					milestone: milestoneToNotify,
					screen: '/home/performance',
					action: 'view_performance',
				},
				sound: 'default' as const,
				badge: 1,
				priority: 'normal' as const,
				channelId: 'performance',
			}));

		try {
			await this.expoPushService.sendPushNotifications(messages);
			await this.setLastNotifiedMilestone(organisationId, milestoneToNotify);
			this.logger.log(`[AggregationMilestone] Notified ${admins.length} admin(s) for org ${organisationId}: crossed ${label}`);
		} catch (error) {
			this.logger.error(`[AggregationMilestone] Failed to send push for org ${organisationId}: ${(error as Error).message}`);
		}
	}
}
