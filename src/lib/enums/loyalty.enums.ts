export enum LoyaltyTier {
	BRONZE = 'bronze',
	SILVER = 'silver',
	GOLD = 'gold',
	PLATINUM = 'platinum'
}

export enum LoyaltyRewardType {
	PERCENTAGE_DISCOUNT = 'percentage_discount',
	FIXED_DISCOUNT = 'fixed_discount',
	FREE_ITEM = 'free_item',
	FREE_SHIPPING = 'free_shipping',
	CASHBACK = 'cashback'
}

export enum LoyaltyRewardClaimStatus {
	PENDING = 'pending',
	REDEEMED = 'redeemed',
	EXPIRED = 'expired',
	CANCELLED = 'cancelled'
}

export enum LoyaltyProfileStatus {
	ACTIVE = 'active',
	INACTIVE = 'inactive',
	SUSPENDED = 'suspended'
}

export enum LoyaltyPointsTransactionType {
	EARNED = 'earned',
	SPENT = 'spent',
	ADJUSTMENT = 'adjustment',
	EXPIRED = 'expired'
}
