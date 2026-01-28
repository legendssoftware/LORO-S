import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { License } from './entities/license.entity';
import { CreateLicenseDto } from './dto/create-license.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';
import { LicenseStatus, SubscriptionPlan, LicenseType } from '../lib/enums/license.enums';
import { PLAN_FEATURES } from '../lib/constants/license-features';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailType } from '../lib/enums/email.enums';
import * as crypto from 'crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Organisation } from '../organisation/entities/organisation.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LicensingService {
	private readonly GRACE_PERIOD_DAYS = 15;
	private readonly RENEWAL_WINDOW_DAYS = 30;
	private readonly LICENSE_CACHE_KEY_PREFIX = 'license_validation:';
	private readonly LICENSE_CACHE_TTL = 3600; // 1 hour in seconds for validation
	private readonly CACHE_PREFIX = 'licenses:';
	private readonly CACHE_TTL: number; // Configurable TTL for general license caching

	constructor(
		@InjectRepository(License)
		private readonly licenseRepository: Repository<License>,
		@InjectRepository(Organisation)
		private readonly organisationRepository: Repository<Organisation>,
		private readonly eventEmitter: EventEmitter2,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		private readonly logger: Logger,
		private readonly configService: ConfigService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
		this.logger.log(`LicensingService initialized with cache TTL: ${this.CACHE_TTL}s`);
	}

	/**
	 * Generate cache key with consistent prefix
	 * @param key - The key identifier (ref, uid, organisationRef, etc.)
	 * @returns Formatted cache key with prefix
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	private generateLicenseKey(): string {
		return crypto.randomBytes(16).toString('hex').toUpperCase();
	}

	private getPlanDefaults(plan: SubscriptionPlan): Partial<License> {
		if (!plan) {
			throw new BadRequestException('Subscription plan is required');
		}

		const defaults = {
			[SubscriptionPlan.STARTER]: {
				maxUsers: 5,
				maxBranches: 1,
				storageLimit: 5120, // 5GB in MB
				apiCallLimit: 10000,
				integrationLimit: 2,
				price: 49,
				features: PLAN_FEATURES[SubscriptionPlan.STARTER],
			},
			[SubscriptionPlan.PROFESSIONAL]: {
				maxUsers: 20,
				maxBranches: 3,
				storageLimit: 20480, // 20GB in MB
				apiCallLimit: 500000,
				integrationLimit: 5,
				price: 99,
				features: PLAN_FEATURES[SubscriptionPlan.PROFESSIONAL],
			},
			[SubscriptionPlan.BUSINESS]: {
				maxUsers: 50,
				maxBranches: 10,
				storageLimit: 102400, // 100GB in MB
				apiCallLimit: 2000000,
				integrationLimit: 15,
				price: 499,
				features: PLAN_FEATURES[SubscriptionPlan.BUSINESS],
			},
			[SubscriptionPlan.ENTERPRISE]: {
				maxUsers: 999999,
				maxBranches: 999999,
				storageLimit: 1024 * 1024, // 1TB in MB
				apiCallLimit: 10000000,
				integrationLimit: 999999,
				price: 999,
				features: PLAN_FEATURES[SubscriptionPlan.ENTERPRISE],
			},
		};

		const planDefaults = defaults[plan];
		if (!planDefaults) {
			throw new BadRequestException(`Invalid subscription plan: ${plan}`);
		}

		return planDefaults;
	}

	async create(createLicenseDto: CreateLicenseDto): Promise<License> {
		try {
			if (!createLicenseDto?.plan) {
				throw new BadRequestException('Subscription plan is required');
			}

			const planDefaults = this.getPlanDefaults(createLicenseDto.plan);

			if (createLicenseDto.plan !== SubscriptionPlan.ENTERPRISE) {
				createLicenseDto = {
					...createLicenseDto,
					maxUsers: planDefaults.maxUsers,
					maxBranches: planDefaults.maxBranches,
					storageLimit: planDefaults.storageLimit,
					apiCallLimit: planDefaults.apiCallLimit,
					integrationLimit: planDefaults.integrationLimit,
					price: planDefaults.price,
				};
			}

			const license = this.licenseRepository.create({
				...createLicenseDto,
				features: planDefaults.features,
				licenseKey: this.generateLicenseKey(),
				status: createLicenseDto?.type === LicenseType.TRIAL ? LicenseStatus.TRIAL : LicenseStatus.ACTIVE,
				organisationRef: String(createLicenseDto.organisationRef),
			});

			const created = await this.licenseRepository.save(license).then((result) => {
				if (Array.isArray(result)) {
					return result[0];
				}
				return result;
			});

			// Invalidate organisation cache since a new license was created
			if (created.uid) {
				await this.invalidateLicenseCache(created.uid.toString(), created);
			}

			// Send email notification
			await this.eventEmitter.emit('send.email', EmailType.LICENSE_CREATED, [created.organisation?.email], {
				name: created.organisation?.name,
				licenseKey: created.licenseKey,
				organisationName: created.organisation?.name,
				plan: created.plan,
				validUntil: created.validUntil,
				features: created.features,
				limits: {
					maxUsers: created.maxUsers,
					maxBranches: created.maxBranches,
					storageLimit: created.storageLimit,
					apiCallLimit: created.apiCallLimit,
					integrationLimit: created.integrationLimit,
				},
			});

			return created;
		} catch (error) {
			throw error;
		}
	}

	async findAll(): Promise<License[]> {
		try {
			return this.licenseRepository.find({
				relations: ['organisation'],
				order: { createdAt: 'DESC' },
			});
		} catch (error) {
			// Silent fail
		}
	}

	async findOne(ref: string): Promise<License> {
		// Check cache first
		const cacheKey = this.getCacheKey(ref);
		const cachedLicense = await this.cacheManager.get<License>(cacheKey);

		if (cachedLicense) {
			return cachedLicense;
		}

		// If not in cache, query database
		const license = await this.licenseRepository.findOne({
			where: { uid: Number(ref) },
			relations: ['organisation'],
		});

		if (!license) {
			throw new NotFoundException(`License with ID ${ref} not found`);
		}

		// Cache the result
		await this.cacheManager.set(cacheKey, license, this.CACHE_TTL);

		return license;
	}

	async findByOrganisation(organisationRef: string): Promise<License[]> {
		try {
			// Check cache first
			const cacheKey = `${this.CACHE_PREFIX}org:${organisationRef}`;
			const cachedLicenses = await this.cacheManager.get<License[]>(cacheKey);

			if (cachedLicenses) {
				return cachedLicenses;
			}

		// organisationRef can be either a Clerk org ID (string like "org_...") or numeric uid
		// First, try to find organization by clerkOrgId
		let organisation = await this.organisationRepository.findOne({
			where: { clerkOrgId: organisationRef },
			select: ['uid', 'ref', 'clerkOrgId'],
		});

		// If not found by clerkOrgId, try to find by ref (which might also be clerkOrgId)
		if (!organisation) {
			organisation = await this.organisationRepository.findOne({
				where: { ref: organisationRef },
				select: ['uid', 'ref', 'clerkOrgId'],
			});
		}

		// If still not found, try parsing as numeric uid (for backward compatibility)
		if (!organisation) {
			const numericUid = Number(organisationRef);
			if (!isNaN(numericUid)) {
				organisation = await this.organisationRepository.findOne({
					where: { uid: numericUid },
					select: ['uid', 'ref', 'clerkOrgId'],
				});
			}
		}

		if (!organisation) {
			this.logger.warn(`[findByOrganisation] Organization not found for ref: ${organisationRef}`);
			// Cache empty result to avoid repeated queries
			await this.cacheManager.set(cacheKey, [], this.CACHE_TTL);
			return [];
		}

		// Query licenses using the organization's ref (which should match clerkOrgId)
		// Use ref first (this is what licenses use as organisationRef), fallback to clerkOrgId, then original parameter
		const orgRef = organisation.ref || organisation.clerkOrgId || organisationRef;
		const licenses = await this.licenseRepository.find({
			where: { organisationRef: orgRef },
			relations: ['organisation'],
			order: { validUntil: 'DESC' },
		});

		// Cache the result
		await this.cacheManager.set(cacheKey, licenses, this.CACHE_TTL);

		return licenses;
		} catch (error) {
			this.logger.error(`[findByOrganisation] Error finding licenses for organisation: ${organisationRef}`, error instanceof Error ? error.message : 'Unknown error');
			// Return empty array on error to maintain consistent return type
			return [];
		}
	}

	async update(ref: string, updateLicenseDto: UpdateLicenseDto): Promise<License> {
		try {
			const license = await this.findOne(ref);

			if (updateLicenseDto.plan && updateLicenseDto.plan !== license.plan) {
				const planDefaults = this.getPlanDefaults(updateLicenseDto.plan);
				Object.assign(updateLicenseDto, {
					features: planDefaults.features,
					...updateLicenseDto,
				});
			}

			Object.assign(license, updateLicenseDto);

			const updated = await this.licenseRepository.save(license);

			// Invalidate cache (pass license to avoid additional query)
			await this.invalidateLicenseCache(ref, updated);

			// Send email notification
			await this.eventEmitter.emit('send.email', EmailType.LICENSE_UPDATED, [updated?.organisation?.email], {
				name: updated?.organisation?.name,
				licenseKey: updated?.licenseKey,
				organisationName: updated?.organisation?.name,
				plan: updated?.plan,
				validUntil: updated?.validUntil,
				features: updated?.features,
				limits: {
					maxUsers: updated?.maxUsers,
					maxBranches: updated?.maxBranches,
					storageLimit: updated?.storageLimit,
					apiCallLimit: updated?.apiCallLimit,
					integrationLimit: updated?.integrationLimit,
				},
			});

			return updated;
		} catch (error) {
			// Silent fail
		}
	}

	async validateLicense(ref: string): Promise<boolean> {
		try {
			// Try to get from cache first
			const cacheKey = `${this.LICENSE_CACHE_KEY_PREFIX}${ref}`;
			const cachedResult = await this.cacheManager.get<boolean>(cacheKey);
			
			if (cachedResult !== undefined) {
				return cachedResult;
			}

			// If not in cache, validate from database
			const license = await this.findOne(ref);
			const now = new Date();

			license.lastValidated = now;
			await this.licenseRepository.save(license);

		let isValid = false;

		if (license.status === LicenseStatus.SUSPENDED) {
			isValid = false;
		} else if (license.validUntil && now > license.validUntil) {
			// Only check expiry if validUntil is set (not null for perpetual licenses)
			const gracePeriodEnd = new Date(
				license.validUntil.getTime() + this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
			);

			if (now <= gracePeriodEnd) {
				license.status = LicenseStatus.GRACE_PERIOD;
				await this.licenseRepository.save(license);
				isValid = true;
			} else {
				license.status = LicenseStatus.EXPIRED;
				await this.licenseRepository.save(license);
				isValid = false;
			}
		} else if (license.status === LicenseStatus.TRIAL) {
			// For trial licenses, validUntil must be set
			isValid = license.validUntil ? now <= license.validUntil : false;
		} else {
			// For perpetual licenses (validUntil is null) or active licenses with future expiry
			isValid = license.status === LicenseStatus.ACTIVE;
		}

			// Cache the result
			await this.cacheManager.set(cacheKey, isValid, this.LICENSE_CACHE_TTL);
			
			return isValid;
		} catch (error) {
			// Handle NotFoundException specifically
			if (error instanceof NotFoundException) {
				this.logger.warn(`License with ID ${ref} not found during validation`);
				const cacheKey = `${this.LICENSE_CACHE_KEY_PREFIX}${ref}`;
				await this.cacheManager.set(cacheKey, false, this.LICENSE_CACHE_TTL);
				return false;
			}
			Logger.error(`Error validating license ${ref}`, error);
			return false;
		}
	}

	/**
	 * Comprehensive cache invalidation for license-related data
	 * Clears all relevant cache entries when license data changes
	 * @param ref - License reference (uid)
	 * @param license - Optional license entity to avoid additional database query
	 */
	async invalidateLicenseCache(ref: string, license?: License): Promise<void> {
		try {
			// If license not provided, fetch it directly from repository (bypassing cache)
			let licenseData = license;
			if (!licenseData) {
				licenseData = await this.licenseRepository.findOne({
					where: { uid: Number(ref) },
					relations: ['organisation'],
				});
			}

			const keysToDelete: string[] = [];

			// Delete license-specific cache
			keysToDelete.push(this.getCacheKey(ref));

			// Delete validation cache
			keysToDelete.push(`${this.LICENSE_CACHE_KEY_PREFIX}${ref}`);

			// Delete organisation-specific cache if license has organisation
			if (licenseData?.organisation) {
				// Try multiple possible organisationRef formats
				if (licenseData.organisation.clerkOrgId) {
					keysToDelete.push(`${this.CACHE_PREFIX}org:${licenseData.organisation.clerkOrgId}`);
				}
				if (licenseData.organisation.ref) {
					keysToDelete.push(`${this.CACHE_PREFIX}org:${licenseData.organisation.ref}`);
				}
				if (licenseData.organisation.uid) {
					keysToDelete.push(`${this.CACHE_PREFIX}org:${licenseData.organisation.uid}`);
				}
			}

			// Also try with organisationRef from license if available
			if (licenseData?.organisationRef) {
				keysToDelete.push(`${this.CACHE_PREFIX}org:${licenseData.organisationRef}`);
			}

			// Clear all caches
			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));

			// Emit event for other services that might be caching license data
			this.eventEmitter.emit('licenses.cache.invalidate', {
				licenseId: ref,
				keys: keysToDelete,
			});
		} catch (error) {
			this.logger.error(`Error invalidating license cache for license ${ref}:`, error instanceof Error ? error.message : 'Unknown error');
		}
	}

	async checkLimits(ref: string, metric: keyof License, currentValue: number): Promise<boolean> {
		try {
			const license = await this.findOne(ref);
			const limit = license?.[metric];

			if (typeof limit !== 'number') {
				throw new BadRequestException(`Invalid metric: ${metric}`);
			}

			const isWithinLimit = currentValue <= limit;

			if (!isWithinLimit) {
				await this.eventEmitter.emit(
					'send.email',
					EmailType.LICENSE_LIMIT_REACHED,
					[license?.organisation?.email],
					{
						name: license?.organisation?.name,
						licenseKey: license?.licenseKey,
						organisationName: license?.organisation?.name,
						plan: license?.plan,
						validUntil: license?.validUntil,
						features: license?.features,
						limits: {
							maxUsers: license?.maxUsers,
							maxBranches: license?.maxBranches,
							storageLimit: license?.storageLimit,
							apiCallLimit: license?.apiCallLimit,
							integrationLimit: license?.integrationLimit,
						},
						metric,
						currentValue,
						limit,
					},
				);
			}

			return isWithinLimit;
		} catch (error) {
			// Silent fail
		}
	}

	async renewLicense(ref: string): Promise<License> {
		try {
			const license = await this.findOne(ref);
			const now = new Date();

			// Cannot renew perpetual licenses (validUntil is null)
			if (!license.validUntil) {
				throw new BadRequestException(
					'Cannot renew a perpetual license. Perpetual licenses do not expire.',
				);
			}

			const renewalStart = new Date(
				license.validUntil.getTime() - this.RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
			);
			if (now < renewalStart) {
				throw new BadRequestException(
					`License can only be renewed within ${this.RENEWAL_WINDOW_DAYS} days of expiration`,
				);
			}

			const validFrom = license.validUntil < now ? now : license.validUntil;
			const validUntil = new Date(validFrom.getTime() + 365 * 24 * 60 * 60 * 1000);

			const renewed = await this.update(ref, {
				validFrom,
				validUntil,
				status: LicenseStatus.ACTIVE,
			});

			// Cache will be invalidated by the update method call above

			this.eventEmitter.emit('send.email', EmailType.LICENSE_RENEWED, [renewed?.organisation?.email], {
				name: renewed?.organisation?.name,
				licenseKey: renewed?.licenseKey,
				organisationName: renewed?.organisation?.name,
				plan: renewed?.plan,
				validUntil: renewed?.validUntil,
				features: renewed?.features,
				limits: {
					maxUsers: renewed?.maxUsers,
					maxBranches: renewed?.maxBranches,
					storageLimit: renewed?.storageLimit,
					apiCallLimit: renewed?.apiCallLimit,
					integrationLimit: renewed?.integrationLimit,
				},
			});

			return renewed;
		} catch (error) {
			Logger.error(`Error renewing license ${ref}`, error);
			throw error;
		}
	}

	async suspendLicense(ref: string): Promise<License> {
		try {
			const suspended = await this.update(ref, { status: LicenseStatus.SUSPENDED });

			// Cache will be invalidated by the update method call

			// Send email notification
			this.eventEmitter.emit('send.email', EmailType.LICENSE_SUSPENDED, [suspended.organisation.email], {
				name: suspended.organisation.name,
				licenseKey: suspended.licenseKey,
				organisationName: suspended.organisation.name,
				plan: suspended.plan,
				validUntil: suspended.validUntil,
				features: suspended.features,
				limits: {
					maxUsers: suspended.maxUsers,
					maxBranches: suspended.maxBranches,
					storageLimit: suspended.storageLimit,
					apiCallLimit: suspended.apiCallLimit,
					integrationLimit: suspended.integrationLimit,
				},
			});

			return suspended;
		} catch (error) {
			Logger.error(`Error suspending license ${ref}`, error);
			throw error;
		}
	}

	async activateLicense(ref: string): Promise<License> {
		try {
			const activated = await this.update(ref, { status: LicenseStatus.ACTIVE });

			// Cache will be invalidated by the update method call

			this.eventEmitter.emit('send.email', EmailType.LICENSE_ACTIVATED, [activated?.organisation?.email], {
				name: activated?.organisation?.name,
				licenseKey: activated?.licenseKey,
				organisationName: activated?.organisation?.name,
				plan: activated?.plan,
				validUntil: activated?.validUntil,
				features: activated?.features,
				limits: {
					maxUsers: activated?.maxUsers,
					maxBranches: activated?.maxBranches,
					storageLimit: activated?.storageLimit,
					apiCallLimit: activated?.apiCallLimit,
					integrationLimit: activated?.integrationLimit,
				},
			});

			return activated;
		} catch (error) {
			Logger.error(`Error activating license ${ref}`, error);
			throw error;
		}
	}

	async findExpiringLicenses(daysThreshold: number = 30): Promise<License[]> {
		try {
			const thresholdDate = new Date();
			thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

			return this.licenseRepository.find({
				where: {
					validUntil: LessThan(thresholdDate),
					status: LicenseStatus.ACTIVE,
				},
				relations: ['organisation'],
			});
		} catch (error) {
			// Silent fail
		}
	}
}
