export enum SMSProvider {
	TWILIO = 'twilio',
	MESSAGEBIRD = 'messagebird',
	AFRICASTALKING = 'africastalking',
}

export enum SMSType {
	LOYALTY_WELCOME = 'loyalty_welcome',
	LOYALTY_POINTS_EARNED = 'loyalty_points_earned',
	LOYALTY_TIER_UPGRADE = 'loyalty_tier_upgrade',
	LOYALTY_REWARD_CLAIMED = 'loyalty_reward_claimed',
	LOYALTY_SPECIALS = 'loyalty_specials',
	LOYALTY_POINTS_STATEMENT = 'loyalty_points_statement',
	LOYALTY_BROADCAST = 'loyalty_broadcast',
}

export enum SMSStatus {
	PENDING = 'pending',
	SENT = 'sent',
	DELIVERED = 'delivered',
	FAILED = 'failed',
	UNDELIVERED = 'undelivered',
}
