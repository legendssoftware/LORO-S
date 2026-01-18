import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { CreateWarningDto } from './dto/create-warning.dto';
import { UpdateWarningDto } from './dto/update-warning.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, Between, MoreThanOrEqual } from 'typeorm';
import { Warning, WarningStatus } from './entities/warning.entity';
import { User } from '../user/entities/user.entity';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommunicationService } from '../communication/communication.service';
import { EmailType } from '../lib/enums/email.enums';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';

@Injectable()
export class WarningsService {
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'warning:';

	constructor(
		@InjectRepository(Warning)
		private warningRepository: Repository<Warning>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly eventEmitter: EventEmitter2,
		private readonly communicationService: CommunicationService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
	}

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	private async clearWarningCache(warningId?: number): Promise<void> {
		try {
			// Get all cache keys
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// If specific warning, clear its cache
			if (warningId) {
				keysToDelete.push(this.getCacheKey(warningId));
			}

			// Clear all pagination and filtered warning list caches
			const warningListCaches = keys.filter(
				(key) =>
					key.startsWith('warnings_page') || // Pagination caches
					key.startsWith('warning:all') || // All warnings cache
					key.includes('_limit'), // Filtered caches
			);
			keysToDelete.push(...warningListCaches);

			// Clear all caches
			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
		} catch (error) {
			return error;
		}
	}

	async create(createWarningDto: CreateWarningDto): Promise<{ message: string; warning?: Warning }> {
		try {
			// Get owner and issuer users
			const [owner, issuer] = await Promise.all([
				this.userRepository.findOne({ where: { uid: createWarningDto.owner.uid } }),
				this.userRepository.findOne({ where: { uid: createWarningDto.issuedBy.uid } }),
			]);

			if (!owner) {
				throw new NotFoundException('Owner user not found');
			}

			if (!issuer) {
				throw new NotFoundException('Issuer user not found');
			}

			// Create the warning
			const warning = this.warningRepository.create({
				...createWarningDto,
				owner,
				issuedBy: issuer,
				issuedAt: createWarningDto.issuedAt || new Date(),
				status: createWarningDto.status || WarningStatus.ACTIVE,
			});

			// Save the warning
			const savedWarning = await this.warningRepository.save(warning);

			// Send email notification to the owner
			if (owner.email) {
				try {
					await this.communicationService.sendEmail(EmailType.WARNING_ISSUED, [owner.email], {
						userName: `${owner.name} ${owner.surname}`,
						userEmail: owner.email,
						warningId: savedWarning.uid,
						reason: savedWarning.reason,
						severity: savedWarning.severity,
						issuedAt: savedWarning.issuedAt.toISOString(),
						expiresAt: savedWarning.expiresAt.toISOString(),
						issuedBy: {
							name: `${issuer.name} ${issuer.surname}`,
							email: issuer.email,
						},
						dashboardLink: `${this.configService.get('FRONTEND_URL')}/warnings/${savedWarning.uid}`,
					});
				} catch (emailError) {
					// Silent fail - email notification is non-critical
					// Don't throw error, continue with warning creation
				}
			}

			// Clear cache
			await this.clearWarningCache();

			return {
				message: 'Warning created successfully',
				warning: savedWarning,
			};
		} catch (error) {
			return { message: error?.message || 'Error creating warning' };
		}
	}

	async findAll(
		filters?: {
			status?: WarningStatus;
			severity?: string;
			ownerId?: number;
			issuerId?: number;
			isExpired?: boolean;
			startDate?: Date;
			endDate?: Date;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT || 10),
	): Promise<PaginatedResponse<Warning>> {
		try {
			const cacheKey = this.getCacheKey(`all_${JSON.stringify(filters)}_${page}_${limit}`);
			const cachedResult = await this.cacheManager.get<PaginatedResponse<Warning>>(cacheKey);

			if (cachedResult) {
				return cachedResult;
			}

			// Calculate skip for pagination
			const skip = (page - 1) * limit;

			// Default where clause
			let whereClause: any = {};

			// Apply filters
			if (filters) {
				if (filters.status) {
					whereClause.status = filters.status;
				}

				if (filters.severity) {
					whereClause.severity = filters.severity;
				}

				if (filters.isExpired !== undefined) {
					whereClause.isExpired = filters.isExpired;
				}

				if (filters.startDate && filters.endDate) {
					whereClause.issuedAt = Between(filters.startDate, filters.endDate);
				} else if (filters.startDate) {
					whereClause.issuedAt = MoreThanOrEqual(filters.startDate);
				} else if (filters.endDate) {
					whereClause.issuedAt = LessThanOrEqual(filters.endDate);
				}
			}

			// Find warnings with relations
			const [warnings, total] = await this.warningRepository.findAndCount({
				where: whereClause,
				skip,
				take: limit,
				order: {
					issuedAt: 'DESC',
				},
				relations: ['owner', 'issuedBy'],
			});

			// Apply post-query filters that can't be done in the database
			let filteredWarnings = warnings;
			if (filters?.ownerId) {
				filteredWarnings = filteredWarnings.filter((warning) => warning.owner.uid === filters.ownerId);
			}

			if (filters?.issuerId) {
				filteredWarnings = filteredWarnings.filter((warning) => warning.issuedBy.uid === filters.issuerId);
			}

			const result = {
				data: filteredWarnings,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: 'Warnings retrieved successfully',
			};

			// Cache result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message || 'Error retrieving warnings',
			};
		}
	}

	async findOne(ref: number): Promise<{ message: string; warning: Warning | null }> {
		try {
			const cacheKey = this.getCacheKey(ref);
			const cachedWarning = await this.cacheManager.get<{ message: string; warning: Warning }>(cacheKey);

			if (cachedWarning) {
				return cachedWarning;
			}

			const warning = await this.warningRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'issuedBy'],
			});

			if (!warning) {
				return {
					message: 'Warning not found',
					warning: null,
				};
			}

			const result = {
				message: 'Warning found',
				warning,
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			return {
				message: error?.message || 'Error finding warning',
				warning: null,
			};
		}
	}

	async update(ref: number, updateWarningDto: UpdateWarningDto): Promise<{ message: string; warning?: Warning }> {
		try {
			const warning = await this.warningRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'issuedBy'],
			});

			if (!warning) {
				throw new NotFoundException('Warning not found');
			}

			// Track updated fields for email notification
			const updatedFields: string[] = [];

			// Handle relationships
			if (updateWarningDto.owner && updateWarningDto.owner.uid !== warning.owner.uid) {
				const newOwner = await this.userRepository.findOne({ where: { uid: updateWarningDto.owner.uid } });
				if (!newOwner) {
					throw new NotFoundException('New owner user not found');
				}
				warning.owner = newOwner;
				updatedFields.push('owner');
			}

			// Update fields
			if (updateWarningDto.reason !== undefined) {
				warning.reason = updateWarningDto.reason;
				updatedFields.push('reason');
			}

			if (updateWarningDto.severity !== undefined) {
				warning.severity = updateWarningDto.severity;
				updatedFields.push('severity');
			}

			if (updateWarningDto.expiresAt !== undefined) {
				warning.expiresAt = new Date(updateWarningDto.expiresAt);
				updatedFields.push('expiresAt');
			}

			if (updateWarningDto.isExpired !== undefined) {
				warning.isExpired = updateWarningDto.isExpired;
				updatedFields.push('isExpired');
			}

			if (updateWarningDto.status !== undefined) {
				const previousStatus = warning.status;
				warning.status = updateWarningDto.status;
				updatedFields.push('status');

				// Handle status-specific logic
				if (warning.status === WarningStatus.EXPIRED && previousStatus !== WarningStatus.EXPIRED) {
					warning.isExpired = true;

					// Send email notification for expired warning
					if (warning.owner.email) {
						try {
							await this.communicationService.sendEmail(
								EmailType.WARNING_EXPIRED,
								[warning.owner.email],
								{
									userName: `${warning.owner.name} ${warning.owner.surname}`,
									userEmail: warning.owner.email,
									warningId: warning.uid,
									reason: warning.reason,
									severity: warning.severity,
									issuedAt: warning.issuedAt.toISOString(),
									expiresAt: warning.expiresAt.toISOString(),
									issuedBy: {
										name: `${warning.issuedBy.name} ${warning.issuedBy.surname}`,
										email: warning.issuedBy.email,
									},
									dashboardLink: `${this.configService.get('FRONTEND_URL')}/warnings/${warning.uid}`,
								},
							);
						} catch (emailError) {
							// Silent fail - email notification is non-critical
						}
					}
				}

				if (warning.status === WarningStatus.REVOKED) {
					warning.isExpired = true;
				}
			}

			// Save the updated warning
			const updatedWarning = await this.warningRepository.save(warning);

			// Send update notification email if fields were updated
			if (updatedFields.length > 0 && warning.owner.email) {
				try {
					await this.communicationService.sendEmail(EmailType.WARNING_UPDATED, [warning.owner.email], {
						userName: `${warning.owner.name} ${warning.owner.surname}`,
						userEmail: warning.owner.email,
						warningId: warning.uid,
						reason: warning.reason,
						severity: warning.severity,
						issuedAt: warning.issuedAt.toISOString(),
						expiresAt: warning.expiresAt.toISOString(),
						updatedFields,
						issuedBy: {
							name: `${warning.issuedBy.name} ${warning.issuedBy.surname}`,
							email: warning.issuedBy.email,
						},
						dashboardLink: `${this.configService.get('FRONTEND_URL')}/warnings/${warning.uid}`,
					});
				} catch (emailError) {
					// Silent fail - email notification is non-critical
				}
			}

			// Clear cache
			await this.clearWarningCache(ref);

			return {
				message: 'Warning updated successfully',
				warning: updatedWarning,
			};
		} catch (error) {
			return { message: error?.message || 'Error updating warning' };
		}
	}

	async remove(ref: number): Promise<{ message: string }> {
		try {
			const warning = await this.warningRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'issuedBy'],
			});

			if (!warning) {
				throw new NotFoundException('Warning not found');
			}

			// Send notification email about warning removal
			if (warning.owner.email) {
				try {
					await this.communicationService.sendEmail(EmailType.WARNING_UPDATED, [warning.owner.email], {
						userName: `${warning.owner.name} ${warning.owner.surname}`,
						userEmail: warning.owner.email,
						warningId: warning.uid,
						reason: warning.reason,
						severity: warning.severity,
						issuedAt: warning.issuedAt.toISOString(),
						expiresAt: warning.expiresAt.toISOString(),
						updatedFields: ['status'],
						issuedBy: {
							name: `${warning.issuedBy.name} ${warning.issuedBy.surname}`,
							email: warning.issuedBy.email,
						},
						dashboardLink: `${this.configService.get('FRONTEND_URL')}/warnings`,
					});
				} catch (emailError) {
					// Silent fail - email notification is non-critical
				}
			}

			// Remove warning
			await this.warningRepository.remove(warning);

			// Clear cache
			await this.clearWarningCache(ref);

			return { message: 'Warning deleted successfully' };
		} catch (error) {
			return { message: error?.message || 'Error deleting warning' };
		}
	}

	async checkExpiredWarnings(): Promise<void> {
		try {
			const now = new Date();
			const expiredWarnings = await this.warningRepository.find({
				where: {
					expiresAt: LessThanOrEqual(now),
					status: WarningStatus.ACTIVE,
					isExpired: false,
				},
				relations: ['owner', 'issuedBy'],
			});

			if (expiredWarnings.length === 0) {
				return;
			}

			// Update all expired warnings
			for (const warning of expiredWarnings) {
				warning.status = WarningStatus.EXPIRED;
				warning.isExpired = true;
				await this.warningRepository.save(warning);

				// Send email notification
				if (warning.owner.email) {
					try {
						await this.communicationService.sendEmail(EmailType.WARNING_EXPIRED, [warning.owner.email], {
							userName: `${warning.owner.name} ${warning.owner.surname}`,
							userEmail: warning.owner.email,
							warningId: warning.uid,
							reason: warning.reason,
							severity: warning.severity,
							issuedAt: warning.issuedAt.toISOString(),
							expiresAt: warning.expiresAt.toISOString(),
							issuedBy: {
								name: `${warning.issuedBy.name} ${warning.issuedBy.surname}`,
								email: warning.issuedBy.email,
							},
							dashboardLink: `${this.configService.get('FRONTEND_URL')}/warnings/${warning.uid}`,
						});
					} catch (emailError) {
						// Silent fail - email notification is non-critical
					}
				}
			}

			// Clear all warning caches
			await this.clearWarningCache();
		} catch (error) {
			// Silent fail - background operation
		}
	}

	async getUserWarnings(userId: number): Promise<{ warnings: Warning[]; message: string }> {
		try {
			const cacheKey = this.getCacheKey(`user_${userId}`);
			const cachedResult = await this.cacheManager.get<{ warnings: Warning[]; message: string }>(cacheKey);

			if (cachedResult) {
				return cachedResult;
			}

			const warnings = await this.warningRepository.find({
				where: {
					owner: { uid: userId },
				},
				relations: ['issuedBy'],
				order: {
					issuedAt: 'DESC',
				},
			});

			const result = {
				warnings,
				message: warnings.length > 0 ? 'Warnings found' : 'No warnings found',
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			return {
				warnings: [],
				message: error?.message || 'Error retrieving user warnings',
			};
		}
	}
}
