import { BadRequestException, Injectable, NotFoundException, Logger, Inject, ForbiddenException } from '@nestjs/common';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { Repository, IsNull, LessThan } from 'typeorm';
import { CheckIn } from './entities/check-in.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateCheckOutDto } from './dto/create-check-out.dto';
import { UpdateVisitDetailsDto } from './dto/update-visit-details.dto';
import { differenceInMinutes, differenceInHours, format, addHours } from 'date-fns';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { User } from 'src/user/entities/user.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationPriority, NotificationEvent, NotificationChannel } from '../lib/types/unified-notification.types';
import { AccessLevel } from 'src/lib/enums/user.enums';
import { GoogleMapsService } from '../lib/services/google-maps.service';
import { LeadsService } from '../leads/leads.service';
import { Quotation } from '../shop/entities/quotation.entity';
import { CreateLeadDto } from '../leads/dto/create-lead.dto';
import { LeadSource } from '../lib/enums/lead.enums';
import { ContactMade } from '../lib/enums/client.enums';
import { Address } from '../lib/interfaces/address.interface';
import { DomainReportResponseDto } from '../lib/dto/domain-report.dto';

@Injectable()
export class CheckInsService {
	private readonly logger = new Logger(CheckInsService.name);
	private readonly CACHE_PREFIX = 'checkins:';
	private readonly CACHE_TTL: number;

	constructor(
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		private rewardsService: RewardsService,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly googleMapsService: GoogleMapsService,
		private readonly leadsService: LeadsService,
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default
	}

	/**
	 * Generate cache key with consistent prefix (same pattern as UserService).
	 * @param key - The key identifier (uid, list params, etc.)
	 * @returns Formatted cache key with prefix
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * List cache key for getAllCheckIns. Deterministic so get and invalidate stay in sync.
	 */
	private getListCacheKey(
		orgId: string,
		hasElevatedAccess: boolean,
		clerkUserId?: string,
		userUid?: string,
		startDate?: Date,
		endDate?: Date,
	): string {
		const scope = hasElevatedAccess ? 'all' : clerkUserId ?? 'none';
		const user = userUid ?? 'none';
		const start = startDate ? startDate.toISOString() : 'none';
		const end = endDate ? endDate.toISOString() : 'none';
		return this.getCacheKey(`list_${orgId}_${scope}_${user}_${start}_${end}`);
	}

	/**
	 * Clear all check-ins list cache so next getAllCheckIns returns fresh data (same manner as UserService invalidateUserCache).
	 * Called after check-in and check-out writes.
	 */
	private async clearCheckInsListCache(): Promise<void> {
		try {
			const keys = await this.cacheManager.store.keys();
			const keysToDelete = keys.filter((key: string) => key.startsWith(this.CACHE_PREFIX));
			await Promise.all(keysToDelete.map((key: string) => this.cacheManager.del(key)));
			if (keysToDelete.length > 0) {
				this.logger.debug(`Cleared ${keysToDelete.length} check-ins cache key(s)`);
			}
		} catch (error) {
			this.logger.error('Error clearing check-ins cache:', (error as Error).message);
		}
	}

	/**
	 * Resolves Clerk org ID (string) to organisation numeric uid.
	 * Looks up by clerkOrgId or ref. Returns null if not found.
	 */
	private async resolveOrgId(clerkOrgId?: string): Promise<number | null> {
		if (!clerkOrgId) {
			return null;
		}
		const org = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId, isDeleted: false },
				{ ref: clerkOrgId, isDeleted: false },
			],
			select: ['uid'],
		});
		return org?.uid ?? null;
	}

	/**
	 * Generate intelligent lead name from check-in data using priority-based approach
	 * Priority: contactFullName > companyName > personSeenPosition+phone > phone > location > default
	 */
	private generateLeadNameFromCheckInData(dto: CreateCheckInDto): string {
		// Priority 1: Contact full name
		if (dto.contactFullName?.trim()) {
			const name = dto.contactFullName.trim();
			this.logger.debug(`Generated lead name from contactFullName: ${name}`);
			return name;
		}

		// Priority 2: Company name
		if (dto.companyName?.trim()) {
			const name = dto.companyName.trim();
			this.logger.debug(`Generated lead name from companyName: ${name}`);
			return name;
		}

		// Priority 3: Person seen position + phone number
		const phone = dto.contactCellPhone?.trim() || dto.contactLandline?.trim();
		if (dto.personSeenPosition?.trim() && phone) {
			const name = `${dto.personSeenPosition.trim()} - ${phone}`;
			this.logger.debug(`Generated lead name from personSeenPosition + phone: ${name}`);
			return name;
		}

		// Priority 4: Phone number only
		if (phone) {
			this.logger.debug(`Generated lead name from phone: ${phone}`);
			return phone;
		}

		// Priority 5: Location-based name
		const locationName = this.getLocationNameFromCheckIn(dto);
		if (locationName) {
			this.logger.debug(`Generated lead name from location: ${locationName}`);
			return locationName;
		}

		// Priority 6: Default with date
		const defaultName = this.getDefaultLeadName();
		this.logger.debug(`Generated default lead name: ${defaultName}`);
		return defaultName;
	}

	/**
	 * Extract location-based name from check-in data
	 * Tries contactAddress, then coordinates
	 */
	private getLocationNameFromCheckIn(dto: CreateCheckInDto): string | null {
		// Try contactAddress
		const addr = dto.contactAddress;
		if (addr) {
			if (addr.street?.trim()) {
				return `Visit at ${addr.street.trim()}`;
			}
			if (addr.suburb?.trim()) {
				return `Visit in ${addr.suburb.trim()}`;
			}
			if (addr.city?.trim()) {
				return `Visit in ${addr.city.trim()}`;
			}
		}

		// Try coordinates from checkInLocation
		if (dto.checkInLocation) {
			const coords = this.parseCoordinates(dto.checkInLocation);
			if (coords) {
				return `Visit at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
			}
		}

		return null;
	}

	/**
	 * Parse coordinates from checkInLocation string format "lat,lng"
	 */
	private parseCoordinates(locationString: string): { lat: number; lng: number } | null {
		if (!locationString?.trim()) {
			return null;
		}

		try {
			const coordinateStr = locationString.trim();
			const coords = coordinateStr.split(',').map(coord => coord.trim());
			
			if (coords.length === 2) {
				const lat = parseFloat(coords[0]);
				const lng = parseFloat(coords[1]);
				
				// Validate coordinates
				if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
					return { lat, lng };
				}
			}
		} catch (error) {
			this.logger.warn(`Failed to parse coordinates from location string: ${locationString}`, error);
		}

		return null;
	}

	/**
	 * Generate default lead name with date
	 */
	private getDefaultLeadName(): string {
		const dateStr = format(new Date(), 'MMM dd, yyyy');
		return `Visit Lead - ${dateStr}`;
	}

	/**
	 * Create a lead from check-in contact information
	 * Extracts contact details and creates a lead when client doesn't exist
	 */
	private async createLeadFromCheckIn(
		createCheckInDto: CreateCheckInDto,
		orgId: string,
		clerkUserId?: string,
	): Promise<{ uid: number } | null> {
		try {
			// Only create lead if we have contact information
			if (!createCheckInDto.contactFullName && !createCheckInDto.contactCellPhone && !createCheckInDto.contactLandline) {
				this.logger.debug('No contact information provided, skipping lead creation');
				return null;
			}

			// Parse location coordinates for latitude/longitude
			let latitude: number | undefined;
			let longitude: number | undefined;
			if (createCheckInDto.checkInLocation) {
				const coordinateStr = createCheckInDto.checkInLocation.trim();
				const coords = coordinateStr.split(',').map(coord => coord.trim());
				if (coords.length === 2) {
					const lat = parseFloat(coords[0]);
					const lng = parseFloat(coords[1]);
					if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
						latitude = lat;
						longitude = lng;
					}
				}
			}

			// Generate intelligent lead name from available check-in data
			const leadName = this.generateLeadNameFromCheckInData(createCheckInDto);

			// Branch is optional; leads are scoped by org and user only
			const createLeadDto: Omit<CreateLeadDto, 'branch'> & { branch?: { uid: number } } = {
				name: leadName,
				companyName: createCheckInDto.companyName,
				phone: createCheckInDto.contactCellPhone || createCheckInDto.contactLandline,
				image: createCheckInDto.contactImage,
				notes: createCheckInDto.notes || `Lead created from check-in visit`,
				latitude,
				longitude,
				source: LeadSource.OTHER,
			};

			// Create lead using LeadsService with source context for logging (no branch)
			const leadResult = await this.leadsService.create(
				createLeadDto as CreateLeadDto,
				orgId,
				undefined,
				clerkUserId,
				'check_in_conversion', // Source context for logging
			);

			if (leadResult?.data?.uid) {
				this.logger.log(`Lead created from check-in: ${leadResult.data.uid}`);
				return { uid: leadResult.data.uid };
			}

			return null;
		} catch (error) {
			this.logger.error(`Failed to create lead from check-in: ${error.message}`, error.stack);
			// Don't fail check-in if lead creation fails (graceful degradation)
			return null;
		}
	}

	/**
	 * Link quotation to check-in and update quotation status
	 */
	private async linkQuotationToCheckIn(
		checkInId: number,
		quotationUid?: number,
		quotationNumber?: string,
		orgId?: string,
	): Promise<{ quotationNumber?: string; quotationStatus?: string; quotationUid?: number } | null> {
		try {
			// If quotationUid is provided, use it; otherwise try to find by quotationNumber
			let quotation: Quotation | null = null;

			if (quotationUid) {
				quotation = await this.quotationRepository.findOne({
					where: { uid: quotationUid },
					select: ['uid', 'quotationNumber', 'status', 'organisationUid'],
				});
			} else if (quotationNumber) {
				quotation = await this.quotationRepository.findOne({
					where: { quotationNumber },
					select: ['uid', 'quotationNumber', 'status', 'organisationUid'],
				});
			}

			if (!quotation) {
				this.logger.warn(`Quotation not found: ${quotationUid || quotationNumber}`);
				return null;
			}

			// Validate quotation belongs to organization if orgId provided
			if (orgId && quotation.organisationUid) {
				// Note: organisationUid in quotation is number, orgId is string (Clerk org ID)
				// We may need to resolve this, but for now we'll skip strict validation
				// as the organisation structure might differ
			}

			// Update check-in with quotation information
			await this.checkInRepository.update(checkInId, {
				quotationUid: quotation.uid,
				quotationNumber: quotation.quotationNumber,
				quotationStatus: quotation.status,
			});

			this.logger.log(`Quotation ${quotation.quotationNumber} linked to check-in ${checkInId}`);

			return {
				quotationNumber: quotation.quotationNumber,
				quotationStatus: quotation.status,
				quotationUid: quotation.uid,
			};
		} catch (error) {
			this.logger.error(`Failed to link quotation to check-in: ${error.message}`, error.stack);
			return null;
		}
	}

	async checkIn(createCheckInDto: CreateCheckInDto, orgId?: string, clerkUserId?: string): Promise<{ message: string; checkInId?: number }> {
		const operationId = `checkin_${Date.now()}`;
		const startTime = Date.now();
		// When clerkUserId is present (token-derived), ignore client-supplied owner; use ownerRef only for legacy callers.
		const ownerRef = clerkUserId ? undefined : (createCheckInDto as { owner?: { uid: string } }).owner?.uid;
		this.logger.log(
			`[${operationId}] Check-in attempt for user: ${ownerRef ?? clerkUserId ?? 'unknown'}, orgId: ${orgId}, clerkUserId: ${clerkUserId}`,
		);

		try {
			// ============================================================
			// CRITICAL PATH: Operations that must complete before response
			// ============================================================

			// Require either owner.uid (legacy) or clerkUserId from token (self check-in). Token-derived identity takes precedence.
			if (!ownerRef && !clerkUserId) {
				this.logger.error(`[${operationId}] User ID or Clerk ID is required for check-in`);
				throw new BadRequestException('User ID or Clerk ID is required for check-in');
			}

			if (!orgId) {
				this.logger.error(`[${operationId}] Organization ID is required for check-in`);
				throw new BadRequestException('Organization ID is required');
			}

			// Resolve user: by clerkUserId (token) or by owner.uid (DTO, string). Org and user only - no branch.
			let user: User | null = null;
			if (clerkUserId) {
				user = await this.userRepository.findOne({
					where: { clerkUserId },
					relations: ['organisation'],
				});
			}
			if (!user && ownerRef) {
				const userWhere = typeof ownerRef === 'string' && ownerRef.startsWith('user_')
					? { clerkUserId: ownerRef }
					: { uid: Number(ownerRef) };
				user = await this.userRepository.findOne({
					where: userWhere,
					relations: ['organisation'],
				});
			}

			if (!user) {
				const ref = ownerRef ?? clerkUserId;
				this.logger.error(`[${operationId}] User not found: ${ref}`);
				throw new NotFoundException('User not found');
			}

			// Validate user belongs to the organization using Clerk org ID (organisationRef)
			if (user.organisationRef && user.organisationRef !== orgId) {
				this.logger.error(
					`[${operationId}] User ${user.uid} belongs to org ${user.organisationRef}, not ${orgId}`,
				);
				throw new BadRequestException('User does not belong to the specified organization');
			}

			// Enhanced data mapping - org and user only, no branch checks
			this.logger.debug(`[${operationId}] Creating check-in record with enhanced data mapping`);
			
			// Prefer clerkUserId from token, then user's clerkUserId from database
			const resolvedClerkUserId = clerkUserId || user.clerkUserId;
			if (!resolvedClerkUserId) {
				this.logger.error(`[${operationId}] No clerkUserId available - cannot set ownerClerkUserId`);
				throw new BadRequestException('User Clerk ID is required for check-in');
			}

			// Check if client exists when client.uid is provided
			let clientExists = false;
			let createdLead: { uid: number } | null = null;

			if (createCheckInDto.client?.uid) {
				const existingClient = await this.clientRepository.findOne({
					where: { uid: createCheckInDto.client.uid, isDeleted: false },
				});
				clientExists = !!existingClient;
				this.logger.debug(`[${operationId}] Client ${createCheckInDto.client.uid} exists: ${clientExists}`);
			}

			// If client doesn't exist or client.uid is not provided, create a lead (no branch)
			if (!clientExists && (!createCheckInDto.client?.uid || createCheckInDto.contactFullName || createCheckInDto.contactCellPhone || createCheckInDto.contactLandline)) {
				this.logger.debug(`[${operationId}] Client not found or not provided, creating lead from contact information`);
				createdLead = await this.createLeadFromCheckIn(createCheckInDto, orgId, resolvedClerkUserId);
				if (createdLead) {
					this.logger.log(`[${operationId}] Lead created: ${createdLead.uid}`);
				}
			}

			const checkInData: any = {
				...createCheckInDto,
				checkInTime: createCheckInDto.checkInTime ? new Date(createCheckInDto.checkInTime) : new Date(),
				// Set owner relation using clerkUserId (not uid) to ensure ownerClerkUserId is set correctly
				owner: {
					clerkUserId: resolvedClerkUserId,
				} as User,
				ownerClerkUserId: resolvedClerkUserId, // Explicitly set the foreign key column
				organisation: {
					clerkOrgId: orgId, // Use Clerk org ID string for relation
				} as Organisation,
				organisationUid: orgId, // Clerk org ID string - key relationship identifier
				// Include new contact and sales fields
				contactFullName: createCheckInDto.contactFullName,
				contactImage: createCheckInDto.contactImage,
				contactCellPhone: createCheckInDto.contactCellPhone,
				contactLandline: createCheckInDto.contactLandline,
				contactAddress: createCheckInDto.contactAddress,
				// Company and business information fields
				companyName: createCheckInDto.companyName,
				businessType: createCheckInDto.businessType,
				personSeenPosition: createCheckInDto.personSeenPosition,
				meetingLink: createCheckInDto.meetingLink,
				salesValue: createCheckInDto.salesValue,
				quotationNumber: createCheckInDto.quotationNumber,
				quotationUid: createCheckInDto.quotationUid,
				// Link lead if created
				leadUid: createdLead?.uid,
				// New check-in enhancement fields
				methodOfContact: createCheckInDto.methodOfContact,
				buildingType: createCheckInDto.buildingType,
				contactMade: createCheckInDto.contactMade === false ? ContactMade.NO : ContactMade.YES,
				// No branch - visits use org and user only
				branch: null,
				branchUid: null,
			};

			// Log when setting ownerClerkUserId and organisationUid for debugging
			this.logger.debug(`[${operationId}] Setting ownerClerkUserId: ${resolvedClerkUserId}`);
			if (orgId) {
				this.logger.debug(`[${operationId}] Setting organisationUid: ${orgId}`);
			}

			// Only set client if it exists
			if (clientExists && createCheckInDto.client?.uid) {
				checkInData.client = { uid: createCheckInDto.client.uid };
				checkInData.clientUid = createCheckInDto.client.uid;
			} else {
				checkInData.client = null;
				checkInData.clientUid = null;
			}

			// Core operation: Save check-in to database
			const checkIn = await this.checkInRepository.save(checkInData);

			if (!checkIn) {
				this.logger.error(`[${operationId}] Failed to create check-in record - database returned null`);
				throw new BadRequestException('Failed to create check-in record');
			}

			this.logger.debug(`[${operationId}] Check-in record created successfully with ID: ${checkIn.uid}`);

			await this.clearCheckInsListCache();

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful save
			// ============================================================
			const duration = Date.now() - startTime;
			this.logger.log(
				`✅ [${operationId}] Check-in successful for user: ${user.clerkUserId ?? user.uid} in ${duration}ms - returning response to client`,
			);

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Check-in recorded successfully',
				checkInId: checkIn.uid,
			};
			this.logger.log(`[${operationId}] Returning response to client with checkInId: ${checkIn.uid}`);

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					this.logger.debug(`🔄 [${operationId}] Starting post-response processing for check-in: ${checkIn.uid}`);

					// 1. Reverse geocode check-in location once and save fullAddress (decode once, save in column)
					try {
						const coordinateStr = createCheckInDto.checkInLocation?.trim();
						if (coordinateStr) {
							const coords = coordinateStr.split(',').map(coord => coord.trim());
							if (coords.length === 2) {
								const latitude = parseFloat(coords[0]);
								const longitude = parseFloat(coords[1]);
								if (!isNaN(latitude) && !isNaN(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
									const geocodingResult = await this.googleMapsService.reverseGeocode({ latitude, longitude });
									await this.checkInRepository.update(checkIn.uid, {
										fullAddress: geocodingResult.address,
									});
									this.logger.debug(`✅ [${operationId}] Check-in fullAddress decoded and saved: ${geocodingResult.formattedAddress}`);
								}
							}
						}
					} catch (geocodingError) {
						this.logger.error(
							`❌ [${operationId}] Failed to reverse geocode check-in location: ${geocodingError.message}`,
							geocodingError.stack,
						);
					}

					// 2. Update client GPS coordinates if client is provided
					if (createCheckInDto.client && createCheckInDto.client.uid) {
						try {
							this.logger.debug(`[${operationId}] Updating client ${createCheckInDto.client.uid} GPS coordinates`);
							await this.clientRepository.update(
								{ uid: createCheckInDto.client.uid },
								{ gpsCoordinates: createCheckInDto.checkInLocation },
							);
							this.logger.debug(`✅ [${operationId}] Client GPS coordinates updated successfully`);
						} catch (clientError) {
							this.logger.error(
								`❌ [${operationId}] Failed to update client GPS coordinates: ${clientError.message}`,
								clientError.stack,
							);
							// Don't fail post-processing if client update fails
						}
					}

					// 3. Send check-in notifications
					try {
						this.logger.debug(`[${operationId}] Sending check-in notifications`);
						await this.sendCheckInNotifications(user.uid, checkIn, user.name, orgId);
						this.logger.debug(`✅ [${operationId}] Check-in notifications sent successfully`);
					} catch (notificationError) {
						this.logger.error(
							`❌ [${operationId}] Failed to send check-in notifications: ${notificationError.message}`,
							notificationError.stack,
						);
						// Don't fail post-processing if notifications fail
					}

					// 4. Award XP with enhanced error handling (use clerk id when available per migration)
					try {
						this.logger.debug(`[${operationId}] Awarding XP for check-in to user: ${user.clerkUserId ?? user.uid}`);
						await this.rewardsService.awardXP(
							{
								owner: user.clerkUserId ?? user.uid,
								amount: XP_VALUES.CHECK_IN_CLIENT,
								action: XP_VALUES_TYPES.CHECK_IN_CLIENT,
								source: {
									id: user.clerkUserId ?? String(user.uid),
									type: XP_VALUES_TYPES.CHECK_IN_CLIENT,
									details: 'Check-in reward',
								},
							},
							orgId,
						);
						this.logger.debug(
							`✅ [${operationId}] XP awarded successfully for check-in to user: ${user.clerkUserId ?? user.uid}`,
						);
					} catch (xpError) {
						this.logger.error(
							`❌ [${operationId}] Failed to award XP for check-in to user: ${user.clerkUserId ?? user.uid}`,
							xpError.stack,
						);
						// Don't fail post-processing if XP award fails
					}

					this.logger.debug(`✅ [${operationId}] Post-response processing completed for check-in: ${checkIn.uid}`);
				} catch (backgroundError) {
					// Log errors but don't affect user experience since response already sent
					this.logger.error(
						`❌ [${operationId}] Background processing failed for check-in ${checkIn.uid}: ${backgroundError.message}`,
						backgroundError.stack,
					);
				}
			});

			return response;
		} catch (error) {
			this.logger.error(`[${operationId}] Check-in failed for user: ${ownerRef ?? clerkUserId ?? 'unknown'}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Send check-in notifications to user and admins (org and user only, no branch)
	 */
	private async sendCheckInNotifications(
		userId: number,
		checkIn: CheckIn,
		userName: string,
		orgId?: string,
	): Promise<void> {
		const operationId = `checkin_notifications_${Date.now()}`;

		try {
			// Build detailed location string
			const locationDetails = checkIn.client?.name 
				? `${checkIn.client.name}` 
				: 'a location';

			// Send detailed notification to the user
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.CHECKIN_CREATED,
				[userId],
				{
					userName: userName,
					clientName: checkIn.client?.name || 'Location',
					checkInId: checkIn.uid,
					checkInTime: checkIn.checkInTime,
					location: locationDetails,
					coordinates: checkIn.checkInLocation,
					orgId,
					timestamp: new Date().toISOString(),
					checkInDetails: {
						id: checkIn.uid,
						userId: userId,
						userName: userName,
						clientName: checkIn.client?.name || 'Location',
						clientId: checkIn.client?.uid,
						checkInTime: checkIn.checkInTime,
						location: checkIn.checkInLocation,
						notes: checkIn.notes,
						createdAt: checkIn.createdAt?.toISOString(),
						orgId,
					},
				},
				{ 
					priority: NotificationPriority.NORMAL,
					customData: {
						screen: '/checkins',
						action: 'view_checkin',
						checkInId: checkIn.uid,
						clientId: checkIn.client?.uid,
					},
				},
			);

			// If organization ID is provided, notify admins
			if (orgId) {
				const orgAdmins = await this.getOrganizationAdmins(orgId);
				if (orgAdmins.length > 0) {
					// Send detailed notification to admins
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_SHIFT_STARTED,
						orgAdmins.map(admin => admin.uid),
						{
							userName: userName,
							clientName: checkIn.client?.name || 'Location',
							checkInId: checkIn.uid,
							checkInTime: checkIn.checkInTime,
							location: locationDetails,
							coordinates: checkIn.checkInLocation,
							orgId,
							timestamp: new Date().toISOString(),
							adminNotification: true,
							checkInDetails: {
								id: checkIn.uid,
								userId: userId,
								userName: userName,
								clientName: checkIn.client?.name || 'Location',
								clientId: checkIn.client?.uid,
								checkInTime: checkIn.checkInTime,
								location: checkIn.checkInLocation,
								notes: checkIn.notes,
								createdAt: checkIn.createdAt?.toISOString(),
								orgId,
							},
						},
						{
							priority: NotificationPriority.LOW,
							customData: {
								screen: '/checkins',
								action: 'view_checkin',
								checkInId: checkIn.uid,
								clientId: checkIn.client?.uid,
								userId: userId,
								adminContext: true,
							},
						},
					);
				}
			}
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to send check-in notifications:`, error.stack);
			throw error;
		}
	}

	/**
	 * Get organization admins for notifications
	 */
	private async getOrganizationAdmins(orgId: string): Promise<any[]> {
		try {
			const adminUsers = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.accessLevel = :accessLevel', { accessLevel: AccessLevel.ADMIN })
				.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
				.select(['user.uid', 'user.email'])
				.getMany();
			return adminUsers;
		} catch (error) {
			this.logger.error(`Error fetching org admins for org ${orgId}:`, error.message);
			return [];
		}
	}

	/**
	 * Send check-out notifications to user and admins (org and user only, no branch)
	 */
	private async sendCheckOutNotifications(
		userId: number,
		checkIn: CheckIn,
		duration: string,
		userName: string,
		fullAddress: string,
		orgId?: string,
	): Promise<void> {
		const operationId = `checkout_notifications_${Date.now()}`;

		try {
			// Build detailed location string
			const locationDetails = checkIn.client?.name 
				? `${checkIn.client.name}` 
				: 'a location';

			// Send detailed notification to the user using CHECKOUT_COMPLETED template
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.CHECKOUT_COMPLETED,
				[Number(userId)],
				{
					userName: userName,
					clientName: checkIn.client?.name || 'Location',
					duration: duration,
					checkInId: checkIn.uid,
					checkOutTime: checkIn.checkOutTime,
					location: locationDetails,
					address: fullAddress,
					orgId,
					timestamp: new Date().toISOString(),
					checkOutDetails: {
						id: checkIn.uid,
						userId: userId,
						userName: userName,
						clientName: checkIn.client?.name || 'Location',
						clientId: checkIn.client?.uid,
						checkInTime: checkIn.checkInTime,
						checkOutTime: checkIn.checkOutTime,
						duration: duration,
						location: checkIn.checkOutLocation,
						address: fullAddress,
						notes: checkIn.notes,
						createdAt: checkIn.createdAt?.toISOString(),
						updatedAt: checkIn.updatedAt?.toISOString(),
						orgId,
					},
				},
				{ 
					priority: NotificationPriority.NORMAL,
					customData: {
						screen: '/checkins',
						action: 'view_checkin',
						checkInId: checkIn.uid,
						clientId: checkIn.client?.uid,
					},
				},	
			);

			// If organization ID is provided, notify admins
			if (orgId) {
				const orgAdmins = await this.getOrganizationAdmins(orgId);
				if (orgAdmins.length > 0) {
					// Send detailed notification to admins
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_SHIFT_ENDED,
						orgAdmins.map(admin => admin.uid),
						{
							userName: userName,
							clientName: checkIn.client?.name || 'Location',
							duration: duration,
							workTimeDisplay: duration,
							checkInId: checkIn.uid,
							checkInTime: checkIn.checkInTime,
							checkOutTime: checkIn.checkOutTime,
							location: locationDetails,
							address: fullAddress,
							orgId,
							timestamp: new Date().toISOString(),
							adminNotification: true,
							checkOutDetails: {
								id: checkIn.uid,
								userId: userId,
								userName: userName,
								clientName: checkIn.client?.name || 'Location',
								clientId: checkIn.client?.uid,
								checkInTime: checkIn.checkInTime,
								checkOutTime: checkIn.checkOutTime,
								duration: duration,
								location: checkIn.checkOutLocation,
								address: fullAddress,
								notes: checkIn.notes,
								createdAt: checkIn.createdAt?.toISOString(),
								updatedAt: checkIn.updatedAt?.toISOString(),
								orgId,
							},
						},
						{
							priority: NotificationPriority.LOW,
							customData: {
								screen: '/checkins',
								action: 'view_checkin',
								checkInId: checkIn.uid,
								clientId: checkIn.client?.uid,
								userId: userId,
								adminContext: true,
							},
						},
					);
				}
			}
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to send check-out notifications:`, error.stack);
			throw error;
		}
	}

	async checkOut(
		createCheckOutDto: CreateCheckOutDto,
		orgId?: string,
		clerkUserId?: string,
	): Promise<{ message: string; duration?: string; checkInId?: number }> {
		const operationId = `checkout_${Date.now()}`;
		const startTime = Date.now();
		// When clerkUserId is present (token-derived), ignore client-supplied owner; use ownerRef only for legacy callers.
		const ownerRef = clerkUserId ? undefined : (createCheckOutDto as { owner?: { uid: string } }).owner?.uid;
		this.logger.log(
			`[${operationId}] Check-out attempt for user: ${ownerRef ?? clerkUserId ?? 'unknown'}, orgId: ${orgId}, clerkUserId: ${clerkUserId}`,
		);

		try {
			// ============================================================
			// CRITICAL PATH: Operations that must complete before response
			// ============================================================

			// Require owner (legacy) or clerkUserId from token. Token-derived identity takes precedence. Org and user only - no branch.
			this.logger.debug(`[${operationId}] Validating check-out data`);
			if (!ownerRef && !clerkUserId) {
				this.logger.error(`[${operationId}] Owner or Clerk ID is required for check-out`);
				throw new BadRequestException('Owner or Clerk ID is required for check-out');
			}

			// Resolve user by clerkUserId or owner.uid (string)
			let user: User | null = null;
			if (clerkUserId) {
				user = await this.userRepository.findOne({
					where: { clerkUserId },
					select: ['uid', 'clerkUserId', 'name'],
				});
			}
			if (!user && ownerRef) {
				const userWhere = typeof ownerRef === 'string' && ownerRef.startsWith('user_')
					? { clerkUserId: ownerRef }
					: { uid: Number(ownerRef) };
				user = await this.userRepository.findOne({
					where: userWhere,
					select: ['uid', 'clerkUserId', 'name'],
				});
			}
			if (!user) {
				this.logger.error(`[${operationId}] User not found: ${ownerRef ?? clerkUserId}`);
				throw new NotFoundException('User not found');
			}

			const clerkId = user.clerkUserId;
			this.logger.debug(`[${operationId}] Finding active check-in for user: ${clerkId}`);
			const checkIn = await this.checkInRepository.findOne({
				where: { ownerClerkUserId: clerkId },
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch'],
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] No active check-in found for user: ${clerkId}`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			if (checkIn.checkOutTime) {
				this.logger.warn(`[${operationId}] User ${clerkId} has already checked out`);
				throw new BadRequestException('User has already checked out');
			}

			this.logger.debug(`[${operationId}] Found active check-in with ID: ${checkIn.uid}, calculating duration`);

			// Calculate duration (needed for response)
			const checkOutTime = new Date(createCheckOutDto.checkOutTime);
			const checkInTime = new Date(checkIn.checkInTime);

			const minutesWorked = differenceInMinutes(checkOutTime, checkInTime);
			const hoursWorked = differenceInHours(checkOutTime, checkInTime);
			const remainingMinutes = minutesWorked % 60;

			const duration = `${hoursWorked}h ${remainingMinutes}m`;
			this.logger.debug(
				`[${operationId}] Calculated work duration: ${duration} (${minutesWorked} minutes total)`,
			);

			// Core operation: Update check-in record with check-out data (without fullAddress - will be updated later)
			this.logger.debug(`[${operationId}] Updating check-in record with check-out data`);

			const updateData: any = {
				checkOutTime: createCheckOutDto?.checkOutTime,
				checkOutPhoto: createCheckOutDto?.checkOutPhoto,
				checkOutLocation: createCheckOutDto?.checkOutLocation,
				duration: duration,
				// fullAddress will be updated in post-response processing
			};

			// Preserve or set ownerClerkUserId and organisationUid
			// Use existing values if present, otherwise set from parameters
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			} else {
				this.logger.warn(`[${operationId}] Warning: No ownerClerkUserId available - existing value is missing and clerkUserId not provided`);
			}

			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			} else {
				this.logger.warn(`[${operationId}] Warning: No organisationUid available - existing value is missing and orgId not provided`);
			}

			// Add optional fields if provided
			if (createCheckOutDto?.notes !== undefined) {
				updateData.notes = createCheckOutDto.notes;
			}
			if (createCheckOutDto?.resolution !== undefined) {
				updateData.resolution = createCheckOutDto.resolution;
			}
			if (createCheckOutDto?.client?.uid !== undefined) {
				updateData.client = { uid: createCheckOutDto.client.uid };
			}

			// Add new contact information fields if provided
			if (createCheckOutDto?.contactFullName !== undefined) {
				updateData.contactFullName = createCheckOutDto.contactFullName;
			}
			if (createCheckOutDto?.contactImage !== undefined) {
				updateData.contactImage = createCheckOutDto.contactImage;
			}
			if (createCheckOutDto?.contactCellPhone !== undefined) {
				updateData.contactCellPhone = createCheckOutDto.contactCellPhone;
			}
			if (createCheckOutDto?.contactLandline !== undefined) {
				updateData.contactLandline = createCheckOutDto.contactLandline;
			}
			if (createCheckOutDto?.contactAddress !== undefined) {
				updateData.contactAddress = createCheckOutDto.contactAddress;
			}

			// Add company and business information fields if provided
			if (createCheckOutDto?.companyName !== undefined) {
				updateData.companyName = createCheckOutDto.companyName;
			}
			if (createCheckOutDto?.businessType !== undefined) {
				updateData.businessType = createCheckOutDto.businessType;
			}
			if (createCheckOutDto?.personSeenPosition !== undefined) {
				updateData.personSeenPosition = createCheckOutDto.personSeenPosition;
			}
			if (createCheckOutDto?.meetingLink !== undefined) {
				updateData.meetingLink = createCheckOutDto.meetingLink;
			}

			// Add sales value if provided
			if (createCheckOutDto?.salesValue !== undefined) {
				updateData.salesValue = createCheckOutDto.salesValue;
			}

			// Add new check-in enhancement fields if provided
			if (createCheckOutDto?.methodOfContact !== undefined) {
				updateData.methodOfContact = createCheckOutDto.methodOfContact;
			}
			if (createCheckOutDto?.buildingType !== undefined) {
				updateData.buildingType = createCheckOutDto.buildingType;
			}
			if (createCheckOutDto?.contactMade !== undefined) {
				updateData.contactMade = createCheckOutDto.contactMade === true ? ContactMade.YES : ContactMade.NO;
			}

			// Link quotation if provided
			if (createCheckOutDto?.quotationUid || createCheckOutDto?.quotationNumber) {
				const quotationLink = await this.linkQuotationToCheckIn(
					checkIn.uid,
					createCheckOutDto.quotationUid,
					createCheckOutDto.quotationNumber,
					orgId,
				);
				if (quotationLink) {
					// Quotation linking already updates the check-in, but we can add status if provided directly
					if (createCheckOutDto?.quotationStatus !== undefined) {
						updateData.quotationStatus = createCheckOutDto.quotationStatus;
					}
				}
			} else if (createCheckOutDto?.quotationStatus !== undefined) {
				// If only status is provided without quotation link, update it
				updateData.quotationStatus = createCheckOutDto.quotationStatus;
			}

			await this.checkInRepository.update(checkIn.uid, updateData);

			await this.clearCheckInsListCache();

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful update
			// ============================================================
			const durationMs = Date.now() - startTime;
			this.logger.log(
				`✅ [${operationId}] Check-out successful for user: ${clerkId} in ${durationMs}ms - returning response to client`,
			);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				duration: duration,
				checkInId: checkIn.uid,
			};
			this.logger.log(`[${operationId}] Returning response to client with checkInId: ${checkIn.uid}, duration: ${duration}`);

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					this.logger.debug(`🔄 [${operationId}] Starting post-response processing for check-out: ${checkIn.uid}`);

					// 1. Reverse geocode the check-in location to get full address (skip if already decoded at check-in time)
					let fullAddress: Address | null = null;
					if (checkIn.fullAddress?.formattedAddress || (checkIn.fullAddress && (checkIn.fullAddress as Address).street)) {
						fullAddress = checkIn.fullAddress as Address;
						this.logger.debug(`[${operationId}] Check-in fullAddress already set, skipping reverse geocode`);
					}
					if (!fullAddress) {
						try {
							this.logger.debug(`[${operationId}] Reverse geocoding check-in location: ${checkIn.checkInLocation}`);

							// Parse coordinates from checkInLocation based on DTO format: "latitude, longitude"
							const coordinateStr = checkIn.checkInLocation?.trim();
							if (!coordinateStr) {
								this.logger.warn(`[${operationId}] Empty check-in location provided`);
							} else {
								// Split by comma and handle various spacing
								const coords = coordinateStr.split(',').map(coord => coord.trim());

								if (coords.length !== 2) {
									this.logger.warn(`[${operationId}] Invalid coordinate format - expected 'latitude, longitude': ${checkIn.checkInLocation}`);
								} else {
									const latitude = parseFloat(coords[0]);
									const longitude = parseFloat(coords[1]);

									// Validate coordinate ranges
									if (isNaN(latitude) || isNaN(longitude)) {
										this.logger.warn(`[${operationId}] Non-numeric coordinates provided: lat=${coords[0]}, lng=${coords[1]}`);
									} else if (latitude < -90 || latitude > 90) {
										this.logger.warn(`[${operationId}] Invalid latitude (must be -90 to 90): ${latitude}`);
									} else if (longitude < -180 || longitude > 180) {
										this.logger.warn(`[${operationId}] Invalid longitude (must be -180 to 180): ${longitude}`);
									} else {
										const geocodingResult = await this.googleMapsService.reverseGeocode({ latitude, longitude });
										fullAddress = geocodingResult.address;
										this.logger.debug(`✅ [${operationId}] Successfully geocoded address: ${geocodingResult.formattedAddress}`);

										// Update check-in record with full address
										await this.checkInRepository.update(checkIn.uid, {
											fullAddress: fullAddress,
										});
										this.logger.debug(`✅ [${operationId}] Updated check-in record with full address`);
									}
								}
							}
						} catch (geocodingError) {
							this.logger.error(
								`❌ [${operationId}] Failed to reverse geocode check-in location: ${geocodingError.message}`,
								geocodingError.stack,
							);
							// Don't fail post-processing if geocoding fails
						}
					}

					// 1b. Reverse geocode the check-out location to get checkOutFullAddress (use DTO; in-memory checkIn has no checkOutLocation yet)
					let checkOutFullAddress: Address | null = null;
					try {
						const outLocationStr = createCheckOutDto?.checkOutLocation?.trim();
						if (outLocationStr) {
							const outCoords = outLocationStr.split(',').map((c: string) => c.trim());
							if (outCoords.length === 2) {
								const outLat = parseFloat(outCoords[0]);
								const outLng = parseFloat(outCoords[1]);
								if (!isNaN(outLat) && !isNaN(outLng) && outLat >= -90 && outLat <= 90 && outLng >= -180 && outLng <= 180) {
									const outGeocodingResult = await this.googleMapsService.reverseGeocode({ latitude: outLat, longitude: outLng });
									checkOutFullAddress = outGeocodingResult.address;
									this.logger.debug(`✅ [${operationId}] Successfully geocoded check-out address: ${outGeocodingResult.formattedAddress}`);
									await this.checkInRepository.update(checkIn.uid, {
										checkOutFullAddress: checkOutFullAddress,
									});
								}
							}
						}
					} catch (checkOutGeocodeError) {
						this.logger.error(
							`❌ [${operationId}] Failed to reverse geocode check-out location: ${checkOutGeocodeError.message}`,
							checkOutGeocodeError.stack,
						);
					}

					// 2. Fetch updated check-in with relations for notifications
					const updatedCheckIn = await this.checkInRepository.findOne({
						where: { uid: checkIn.uid },
						relations: ['owner', 'client', 'branch'],
					});

					if (!updatedCheckIn) {
						this.logger.warn(`⚠️ [${operationId}] Could not fetch updated check-in ${checkIn.uid} for post-processing`);
						return;
					}

					// 3. Send check-out notifications (use resolved user)
					try {
						this.logger.debug(`[${operationId}] Sending check-out notifications`);
						const userName = updatedCheckIn.owner?.name || 'Staff member';
						const fullAddressStr = (fullAddress?.formattedAddress
							?? (fullAddress ? [fullAddress.street, fullAddress.suburb, fullAddress.city, fullAddress.state, fullAddress.country].filter(Boolean).join(', ') : ''))
							|| '';
						await this.sendCheckOutNotifications(
							user.uid,
							updatedCheckIn,
							duration,
							userName,
							fullAddressStr,
							orgId,
						);
						this.logger.debug(`✅ [${operationId}] Check-out notifications sent successfully`);
					} catch (notificationError) {
						this.logger.error(
							`❌ [${operationId}] Failed to send check-out notifications: ${notificationError.message}`,
							notificationError.stack,
						);
						// Don't fail post-processing if notifications fail
					}

					// 4. Award XP with enhanced error handling (use clerk id when available per migration)
					try {
						this.logger.debug(`[${operationId}] Awarding XP for check-out to user: ${clerkId}`);
						await this.rewardsService.awardXP(
							{
								owner: user.clerkUserId ?? user.uid,
								amount: 10,
								action: 'CHECK_OUT',
								source: {
									id: user.clerkUserId ?? String(user.uid),
									type: 'check-in',
									details: 'Check-out reward',
								},
							},
							orgId,
						);
						this.logger.debug(
							`✅ [${operationId}] XP awarded successfully for check-out to user: ${clerkId}`,
						);
					} catch (xpError) {
						this.logger.error(
							`❌ [${operationId}] Failed to award XP for check-out to user: ${clerkId}`,
							xpError.stack,
						);
						// Don't fail post-processing if XP award fails
					}

					this.logger.debug(`✅ [${operationId}] Post-response processing completed for check-out: ${checkIn.uid}`);
				} catch (backgroundError) {
					// Log errors but don't affect user experience since response already sent
					this.logger.error(
						`❌ [${operationId}] Background processing failed for check-out ${checkIn.uid}: ${backgroundError.message}`,
						backgroundError.stack,
					);
				}
			});

			return response;
		} catch (error) {
			this.logger.error(
				`[${operationId}] Check-out failed for user: ${ownerRef ?? clerkUserId ?? 'unknown'}`,
				error.stack,
			);
			return {
				message: error?.message,
				duration: null,
			};
		}
	}

	async checkInStatus(reference: string): Promise<any> {
		this.logger.log(`checkInStatus: reference=${reference}`);
		try {
			// Reference can be clerk id (user_xxx) or numeric string; filter by ownerClerkUserId
			const whereClause = reference.startsWith('user_')
				? { ownerClerkUserId: reference }
				: { owner: { uid: Number(reference) } };
			const [checkIn] = await this.checkInRepository.find({
				where: whereClause,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client'],
			});

			if (!checkIn) {
				this.logger.debug('checkInStatus: no check-in found');
				throw new NotFoundException('Check-in not found');
			}

			const nextAction =
				checkIn.checkInTime && checkIn.checkInLocation && !checkIn.checkOutTime ? 'checkOut' : 'checkIn';
			this.logger.log(`checkInStatus: check-in found, nextAction=${nextAction}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				nextAction,
				checkedIn: nextAction === 'checkOut',
				...checkIn,
			};

			return response;
		} catch (error) {
			this.logger.debug(`checkInStatus: error, returning default nextAction=Check In`);
			const response = {
				message: error?.message,
				nextAction: 'Check In',
				checkedIn: false,
			};

			return response;
		}
	}

	/**
	 * Find check-ins that were never ended (no check-out) and automatically end them
	 * after the given cutoff hours. Used by scheduler to close stale visits.
	 */
	async autoEndStaleVisits(cutoffHours = 6): Promise<{ ended: number }> {
		const operationId = `autoEndStale_${Date.now()}`;
		const cutoff = addHours(new Date(), -cutoffHours);
		const stale = await this.checkInRepository.find({
			where: {
				checkOutTime: IsNull(),
				checkInTime: LessThan(cutoff),
			},
			order: { checkInTime: 'ASC' },
		});
		if (stale.length === 0) {
			this.logger.debug(`[${operationId}] No stale visits to auto-end`);
			return { ended: 0 };
		}
		this.logger.log(`[${operationId}] Auto-ending ${stale.length} visit(s) older than ${cutoffHours}h`);
		let ended = 0;
		for (const checkIn of stale) {
			try {
				const checkInTime = new Date(checkIn.checkInTime);
				const checkOutTime = addHours(checkInTime, cutoffHours);
				const minutesWorked = differenceInMinutes(checkOutTime, checkInTime);
				const hoursWorked = differenceInHours(checkOutTime, checkInTime);
				const remainingMinutes = minutesWorked % 60;
				const duration = `${hoursWorked}h ${remainingMinutes}m`;
				const notesSuffix = ' (Auto-ended after 6h)';
				const existingNotes = checkIn.notes?.trim() ?? '';
				const notes = existingNotes ? `${existingNotes}${notesSuffix}` : notesSuffix;
				await this.checkInRepository.update(checkIn.uid, {
					checkOutTime,
					checkOutLocation: '-',
					checkOutPhoto: 'auto-ended',
					duration,
					notes,
				});
				ended++;
				this.logger.log(`[${operationId}] Auto-ended check-in ${checkIn.uid} (checkIn ${format(checkInTime, 'yyyy-MM-dd HH:mm')})`);
			} catch (err) {
				this.logger.error(`[${operationId}] Failed to auto-end check-in ${checkIn.uid}: ${err?.message}`, err?.stack);
			}
		}
		return { ended };
	}

	/**
	 * Get all check-ins for the organisation (or for a specific user when userUid provided).
	 * When startDate/endDate are omitted, the result set is unbounded and returns all matching check-ins.
	 */
	async getAllCheckIns(
		orgId?: string,
		clerkUserId?: string,
		userAccessLevel?: string,
		userUid?: string,
		startDate?: Date,
		endDate?: Date,
	): Promise<any> {
		const operationId = `getAllCheckIns_${Date.now()}`;
		try {
			if (!orgId) {
				this.logger.error(`[${operationId}] Organization ID is required`);
				throw new BadRequestException('Organization ID is required');
			}

			// Determine if user has elevated access (can see all check-ins)
			const hasElevatedAccess = [
				AccessLevel.ADMIN,
				AccessLevel.OWNER,
				AccessLevel.MANAGER,
			].includes(userAccessLevel as AccessLevel);

			this.logger.log(
				`[${operationId}] getAllCheckIns entry: orgId=${orgId}, clerkUserId=${clerkUserId ?? 'n/a'}, userAccessLevel=${userAccessLevel ?? 'n/a'}, hasElevatedAccess=${hasElevatedAccess}, userUid=${userUid ?? 'n/a'}, startDate=${startDate?.toISOString() ?? 'n/a'}, endDate=${endDate?.toISOString() ?? 'n/a'}. No branch filter; org-scoped for elevated, owner-only for regular.`,
			);

			// Read-through cache (same pattern as UserService)
			const listCacheKey = this.getListCacheKey(
				orgId,
				hasElevatedAccess,
				clerkUserId,
				userUid,
				startDate,
				endDate,
			);
			const cached = await this.cacheManager.get<{ message: string; checkIns: any[] }>(listCacheKey);
			if (cached) {
				this.logger.debug(`[${operationId}] Returning cached check-ins list (${cached.checkIns?.length ?? 0} items)`);
				return cached;
			}

			this.logger.debug(`[${operationId}] Building query with filters for org: ${orgId}, elevated: ${hasElevatedAccess}`);

			const queryBuilder = this.checkInRepository
				.createQueryBuilder('checkIn')
				.leftJoinAndSelect('checkIn.owner', 'owner')
				.leftJoinAndSelect('checkIn.client', 'client')
				.leftJoinAndSelect('checkIn.organisation', 'organisation')
				.where('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });

			// Access control: Regular users can only see their own check-ins
			if (!hasElevatedAccess) {
				if (!clerkUserId) {
					throw new BadRequestException('Clerk user ID is required to retrieve check-ins');
				}
				// Filter by ownerClerkUserId
				queryBuilder.andWhere('checkIn.ownerClerkUserId = :clerkUserId', { clerkUserId });
			} else if (userUid) {
				// Managers/admins can filter by specific user
				// Support both Clerk user ID (user_xxx) and numeric UID
				if (userUid.startsWith('user_')) {
					queryBuilder.andWhere('checkIn.ownerClerkUserId = :userUid', { userUid });
				} else {
					queryBuilder.andWhere('owner.uid = :userUid', { userUid: Number(userUid) });
				}
			}

			// Add date range filter if provided
			if (startDate && endDate) {
				queryBuilder.andWhere('checkIn.checkInTime BETWEEN :startDate AND :endDate', {
					startDate,
					endDate,
				});
			} else if (startDate) {
				queryBuilder.andWhere('checkIn.checkInTime >= :startDate', { startDate });
			} else if (endDate) {
				queryBuilder.andWhere('checkIn.checkInTime <= :endDate', { endDate });
			}

			queryBuilder.orderBy('checkIn.checkInTime', 'DESC');

			// Log applied filters: org only, or org + ownerClerkUserId, or org + userUid, plus optional date range
			const filterParts = ['org'];
			if (!hasElevatedAccess) filterParts.push('ownerClerkUserId');
			else if (userUid) filterParts.push('userUid');
			if (startDate || endDate) filterParts.push('date range');
			this.logger.log(`[${operationId}] Applied filters: ${filterParts.join(', ')}. Executing query.`);

			const checkIns = await queryBuilder.getMany();

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				checkIns,
			};

			await this.cacheManager.set(listCacheKey, response, this.CACHE_TTL);
			this.logger.debug(`[${operationId}] Cached check-ins list with key: ${listCacheKey}`);

			this.logger.log(`[${operationId}] Successfully retrieved ${checkIns.length} check-ins. Returning ${checkIns.length} check-ins.`);
			return response;
		} catch (error) {
			this.logger.error(`[${operationId}] Error retrieving check-ins:`, error.stack);
			this.logger.log(`[${operationId}] Returning empty checkIns due to error: ${error?.message}`);
			if (error instanceof BadRequestException) {
				throw error;
			}
			const response = {
				message: error?.message || 'Error retrieving check-ins',
				checkIns: [],
			};
			return response;
		}
	}

	/**
	 * Server-generated report: aggregated counts by day for the given date range (byStatus empty for check-ins).
	 */
	async getReport(
		from: string,
		to: string,
		orgId: string,
		clerkUserId?: string,
		userAccessLevel?: string,
	): Promise<DomainReportResponseDto> {
		const startDate = new Date(from);
		const endDate = new Date(to);
		const result = await this.getAllCheckIns(orgId, clerkUserId, userAccessLevel, undefined, startDate, endDate);
		const checkIns = result?.checkIns ?? [];
		const byDayMap = new Map<string, number>();
		for (const c of checkIns) {
			const dateKey = new Date(c.checkInTime).toISOString().slice(0, 10);
			byDayMap.set(dateKey, (byDayMap.get(dateKey) ?? 0) + 1);
		}
		const byDay = Array.from(byDayMap.entries())
			.map(([date, count]) => ({ date, count }))
			.sort((a, b) => a.date.localeCompare(b.date));
		return { total: checkIns.length, byStatus: [], byDay, meta: { from, to } };
	}

	async getUserCheckIns(userUid: string, organizationUid?: string): Promise<any> {
		this.logger.log(`getUserCheckIns entry: userUid=${userUid}, organizationUid=${organizationUid ?? 'n/a'}`);
		try {
			// Use ownerClerkUserId if it's a Clerk ID, otherwise use uid (string coercion). Listing by user/org only; no branch filter.
			const whereCondition: any = userUid.startsWith('user_')
				? { ownerClerkUserId: userUid }
				: { owner: { uid: userUid } };

			if (organizationUid) {
				// organisationUid is now a string (Clerk org ID), filter directly
				whereCondition.organisationUid = organizationUid;
			}

			const checkIns = await this.checkInRepository.find({
				where: whereCondition,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'organisation'],
			});

			if (!checkIns || checkIns.length === 0) {
				this.logger.log('getUserCheckIns: No check-ins found for user');
				const response = {
					message: process.env.SUCCESS_MESSAGE,
					checkIns: [],
					user: null,
				};
				return response;
			}
			this.logger.log(`getUserCheckIns: returning ${checkIns.length} check-ins`);

			// Get user info from the first check-in record
			const userInfo = checkIns[0]?.owner || null;

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns,
				user: userInfo,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				checkIns: [],
				user: null,
			};

			return response;
		}
	}

	/**
	 * Fast update endpoint for check-in photo URL
	 * Used after background upload completes
	 */
	async updateCheckInPhoto(
		checkInId: number,
		photoUrl: string,
		orgId?: string,
		clerkUserId?: string,
	): Promise<{ message: string }> {
		const operationId = `update_checkin_photo_${Date.now()}`;
		const startTime = Date.now();
		this.logger.log(`[${operationId}] Updating check-in photo for check-in: ${checkInId}`);

		try {
			// Find check-in record
			const checkIn = await this.checkInRepository.findOne({
				where: { uid: checkInId },
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] Check-in not found: ${checkInId}`);
				throw new NotFoundException('Check-in not found');
			}

			// Build update data, preserving or setting ownerClerkUserId and organisationUid
			const updateData: any = {
				checkInPhoto: photoUrl,
			};

			// Preserve or set ownerClerkUserId
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			}

			// Preserve or set organisationUid
			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			}

			// Update photo URL and preserve/set relationship keys
			await this.checkInRepository.update(checkInId, updateData);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [${operationId}] Check-in photo updated successfully in ${duration}ms. Returning success.`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Check-in photo updated successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ [${operationId}] Failed to update check-in photo after ${duration}ms: ${error.message}`,
				error.stack,
			);
			return {
				message: error?.message || 'Failed to update check-in photo',
			};
		}
	}

	/**
	 * Fast update endpoint for check-out photo URL
	 * Used after background upload completes
	 */
	async updateCheckOutPhoto(
		checkInId: number,
		photoUrl: string,
		orgId?: string,
		clerkUserId?: string,
	): Promise<{ message: string }> {
		const operationId = `update_checkout_photo_${Date.now()}`;
		const startTime = Date.now();
		this.logger.log(`[${operationId}] Updating check-out photo for check-in: ${checkInId}`);

		try {
			// Find check-in record
			const checkIn = await this.checkInRepository.findOne({
				where: { uid: checkInId },
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] Check-in not found: ${checkInId}`);
				throw new NotFoundException('Check-in not found');
			}

			// Build update data, preserving or setting ownerClerkUserId and organisationUid
			const updateData: any = {
				checkOutPhoto: photoUrl,
			};

			// Preserve or set ownerClerkUserId
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			}

			// Preserve or set organisationUid
			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			}

			// Update photo URL and preserve/set relationship keys
			await this.checkInRepository.update(checkInId, updateData);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [${operationId}] Check-out photo updated successfully in ${duration}ms. Returning success.`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Check-out photo updated successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ [${operationId}] Failed to update check-out photo after ${duration}ms: ${error.message}`,
				error.stack,
			);
			return {
				message: error?.message || 'Failed to update check-out photo',
			};
		}
	}

	/**
	 * Update visit details (client, notes, resolution) after check-out
	 */
	async updateVisitDetails(
		checkInId: number,
		clientId?: number,
		notes?: string,
		resolution?: string,
		orgId?: string,
		clerkUserId?: string,
		updateDto?: UpdateVisitDetailsDto,
	): Promise<{ message: string }> {
		const operationId = `update_visit_details_${Date.now()}`;
		const startTime = Date.now();
		this.logger.log(`[${operationId}] Updating visit details for check-in: ${checkInId}`);

		try {
			// Find check-in record
			const checkIn = await this.checkInRepository.findOne({
				where: { uid: checkInId },
			});

			if (!checkIn) {
				this.logger.error(`[${operationId}] Check-in not found: ${checkInId}`);
				throw new NotFoundException('Check-in not found');
			}

			// Build update data
			const updateData: any = {};
			if (clientId !== undefined) {
				updateData.client = { uid: clientId };
			}
			if (notes !== undefined) {
				updateData.notes = notes;
			}
			if (resolution !== undefined) {
				updateData.resolution = resolution;
			}
			if (updateDto?.followUp !== undefined) {
				updateData.followUp = updateDto.followUp;
			}

			// Add new fields from DTO if provided
			if (updateDto) {
				if (updateDto.contactFullName !== undefined) {
					updateData.contactFullName = updateDto.contactFullName;
				}
				if (updateDto.contactImage !== undefined) {
					updateData.contactImage = updateDto.contactImage;
				}
				if (updateDto.contactCellPhone !== undefined) {
					updateData.contactCellPhone = updateDto.contactCellPhone;
				}
				if (updateDto.contactLandline !== undefined) {
					updateData.contactLandline = updateDto.contactLandline;
				}
				if (updateDto.contactAddress !== undefined) {
					updateData.contactAddress = updateDto.contactAddress;
				}
				if (updateDto.companyName !== undefined) {
					updateData.companyName = updateDto.companyName;
				}
				if (updateDto.businessType !== undefined) {
					updateData.businessType = updateDto.businessType;
				}
				if (updateDto.personSeenPosition !== undefined) {
					updateData.personSeenPosition = updateDto.personSeenPosition;
				}
				if (updateDto.meetingLink !== undefined) {
					updateData.meetingLink = updateDto.meetingLink;
				}
				if (updateDto.salesValue !== undefined) {
					updateData.salesValue = updateDto.salesValue;
				}
				if (updateDto.quotationNumber !== undefined) {
					updateData.quotationNumber = updateDto.quotationNumber;
				}
				if (updateDto.quotationUid !== undefined) {
					updateData.quotationUid = updateDto.quotationUid;
				}
				if (updateDto.quotationStatus !== undefined) {
					updateData.quotationStatus = updateDto.quotationStatus;
				}
				// Add new check-in enhancement fields if provided
				if (updateDto.methodOfContact !== undefined) {
					updateData.methodOfContact = updateDto.methodOfContact;
				}
				if (updateDto.buildingType !== undefined) {
					updateData.buildingType = updateDto.buildingType;
				}
				if (updateDto.contactMade !== undefined) {
					updateData.contactMade = updateDto.contactMade === true ? ContactMade.YES : ContactMade.NO;
				}
				if (updateDto.followUp !== undefined) {
					updateData.followUp = updateDto.followUp;
				}
			}

			// Preserve or set ownerClerkUserId
			if (checkIn.ownerClerkUserId) {
				updateData.ownerClerkUserId = checkIn.ownerClerkUserId;
				this.logger.debug(`[${operationId}] Preserving existing ownerClerkUserId: ${checkIn.ownerClerkUserId}`);
			} else if (clerkUserId) {
				updateData.ownerClerkUserId = clerkUserId;
				this.logger.debug(`[${operationId}] Setting ownerClerkUserId from parameter: ${clerkUserId}`);
			}

			// Preserve or set organisationUid
			if (checkIn.organisationUid) {
				updateData.organisationUid = checkIn.organisationUid;
				this.logger.debug(`[${operationId}] Preserving existing organisationUid: ${checkIn.organisationUid}`);
			} else if (orgId) {
				updateData.organisationUid = orgId;
				this.logger.debug(`[${operationId}] Setting organisationUid from parameter: ${orgId}`);
			}

			// Update visit details and preserve/set relationship keys
			await this.checkInRepository.update(checkInId, updateData);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [${operationId}] Visit details updated successfully in ${duration}ms. Returning success.`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Visit details updated successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ [${operationId}] Failed to update visit details after ${duration}ms: ${error.message}`,
				error.stack,
			);
			return {
				message: error?.message || 'Failed to update visit details',
			};
		}
	}

	/**
	 * Convert an existing check-in to a lead
	 */
	/**
	 * Generate a meaningful lead name from check-in data when no contact info is available
	 * Uses location, address, date, or a default name
	 */
	private generateLeadNameFromCheckIn(checkIn: CheckIn): string {
		// Try to use address information
		if (checkIn.fullAddress) {
			const addr = checkIn.fullAddress;
			if (addr.street) {
				return `Visit at ${addr.street}`;
			}
			if (addr.suburb) {
				return `Visit in ${addr.suburb}`;
			}
			if (addr.city) {
				return `Visit in ${addr.city}`;
			}
		}

		// Use check-in date
		if (checkIn.checkInTime) {
			const dateStr = new Date(checkIn.checkInTime).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
			});
			return `Visit Lead - ${dateStr}`;
		}

		// Default fallback
		return `Visit Lead #${checkIn.uid}`;
	}

	/**
	 * Build comprehensive notes for lead from check-in information
	 */
	private buildLeadNotesFromCheckIn(checkIn: CheckIn, checkInId: number): string {
		const notesParts: string[] = [];

		// Add existing notes if available
		if (checkIn.notes) {
			notesParts.push(checkIn.notes);
		}

		// Add resolution if available
		if (checkIn.resolution) {
			notesParts.push(`Resolution: ${checkIn.resolution}`);
		}

		// Add follow-up if available
		if (checkIn.followUp) {
			notesParts.push(`Follow-up: ${checkIn.followUp}`);
		}

		// Add duration if available
		if (checkIn.duration) {
			notesParts.push(`Visit duration: ${checkIn.duration}`);
		}

		// Add check-in time
		if (checkIn.checkInTime) {
			const timeStr = new Date(checkIn.checkInTime).toLocaleString('en-US');
			notesParts.push(`Check-in time: ${timeStr}`);
		}

		// Add base message
		const baseMessage = `Lead created from check-in visit (ID: ${checkInId})`;
		
		if (notesParts.length > 0) {
			return `${baseMessage}\n\n${notesParts.join('\n')}`;
		}

		return baseMessage;
	}

	async convertCheckInToLead(
		checkInId: number,
		orgId: string,
		clerkUserId?: string,
	): Promise<{ message: string; lead?: { uid: number; name: string } }> {
		const operationId = `convert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const startTime = Date.now();

		try {
			this.logger.log(`[${operationId}] Starting convert check-in to lead for checkInId: ${checkInId}`);

			// Find check-in with relations (org and user only - no branch)
			const checkIn = await this.checkInRepository.findOne({
				where: { uid: checkInId },
				relations: ['owner', 'organisation', 'client'],
			});

			if (!checkIn) {
				throw new NotFoundException(`Check-in with ID ${checkInId} not found`);
			}

			// Check if lead already exists
			if (checkIn.leadUid) {
				throw new BadRequestException(`Check-in already has a lead associated (leadUid: ${checkIn.leadUid})`);
			}

			// Validate organization
			if (checkIn.organisationUid !== orgId) {
				throw new ForbiddenException('Check-in does not belong to your organization');
			}

			// Parse location coordinates for latitude/longitude
			let latitude: number | undefined;
			let longitude: number | undefined;
			if (checkIn.checkInLocation) {
				const coordinateStr = checkIn.checkInLocation.trim();
				const coords = coordinateStr.split(',').map(coord => coord.trim());
				if (coords.length === 2) {
					const lat = parseFloat(coords[0]);
					const lng = parseFloat(coords[1]);
					if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
						latitude = lat;
						longitude = lng;
					}
				}
			}

			// Extract contact information with fallback priority
			// Priority: check-in contact > client > companyName > location-based name
			const leadName = checkIn.contactFullName || 
				checkIn.client?.contactPerson || 
				checkIn.client?.name || 
				checkIn.companyName || 
				this.generateLeadNameFromCheckIn(checkIn);

			const leadPhone = checkIn.contactCellPhone || 
				checkIn.contactLandline || 
				checkIn.client?.phone || 
				checkIn.client?.alternativePhone;

			const leadEmail = checkIn.contactEmail || checkIn.client?.email;

			// Build lead DTO from check-in information with fallbacks (org and user only - no branch)
			const createLeadDto: Omit<CreateLeadDto, 'branch'> & { branch?: { uid: number } } = {
				name: leadName,
				phone: leadPhone,
				email: leadEmail,
				companyName: checkIn.companyName || checkIn.client?.name,
				image: checkIn.contactImage || checkIn.checkInPhoto || checkIn.client?.logo,
				notes: this.buildLeadNotesFromCheckIn(checkIn, checkInId),
				latitude,
				longitude,
				source: LeadSource.OTHER,
			};

			// Log before creating lead from visit conversion
			this.logger.log(
				`[${operationId}] Creating lead from visit conversion (checkInId: ${checkInId}, name: ${leadName || 'N/A'})...`
			);

			// Create lead using LeadsService (no branch - org scope only)
			const leadResult = await this.leadsService.create(
				createLeadDto as CreateLeadDto,
				orgId,
				undefined,
				clerkUserId,
				'visit_conversion', // Source context for logging
			);

			if (!leadResult?.data?.uid) {
				throw new BadRequestException('Failed to create lead from check-in');
			}

			// Log successful lead creation with details
			this.logger.log(
				`[${operationId}] Lead created successfully from visit conversion: leadId=${leadResult.data.uid}, name=${leadResult.data.name || leadName}`
			);

			// Update check-in with leadUid
			checkIn.leadUid = leadResult.data.uid;
			await this.checkInRepository.save(checkIn);

			// Note: Lead cache invalidation is already handled by leadsService.create() internally
			// Mobile-side React Query cache invalidation will handle UI updates

			const duration = Date.now() - startTime;
			this.logger.log(
				`✅ [${operationId}] Successfully converted check-in ${checkInId} to lead ${leadResult.data.uid} after ${duration}ms`
			);
			this.logger.log(`[${operationId}] Returning success with lead uid=${leadResult.data.uid}, name=${leadResult.data.name || leadName}`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Check-in converted to lead successfully',
				lead: {
					uid: leadResult.data.uid,
					name: leadResult.data.name || leadName,
				},
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(
				`❌ [${operationId}] Failed to convert check-in to lead after ${duration}ms: ${error.message}`,
				error.stack,
			);
			if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
				throw error;
			}
			throw new BadRequestException(error?.message || 'Failed to convert check-in to lead');
		}
	}
}
