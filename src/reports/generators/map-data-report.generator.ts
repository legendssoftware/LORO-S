import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, IsNull, In, Not } from 'typeorm';
import { startOfDay, subDays } from 'date-fns';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { Client } from '../../clients/entities/client.entity';
import { Competitor } from '../../competitors/entities/competitor.entity';
import { Quotation } from '../../shop/entities/quotation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { GeneralStatus } from '../../lib/enums/status.enums';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Journal } from '../../journal/entities/journal.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { Tracking } from '../../tracking/entities/tracking.entity';
import { Claim } from '../../claims/entities/claim.entity';
import { GoogleMapsService } from '../../lib/services/google-maps.service';
import { TrackingService } from '../../tracking/tracking.service';

interface MapDataRequestParams {
	organisationId: number;
	branchId?: number;
	userId?: number; // Add user context for authorization
	includeGpsAnalysis?: boolean; // Enable advanced GPS analysis
	includeRouteOptimization?: boolean; // Enable route optimization for workers
	gpsAnalysisDate?: Date; // Specific date for GPS analysis (defaults to today)
}

@Injectable()
export class MapDataReportGenerator {
	private readonly logger = new Logger(MapDataReportGenerator.name);
	private readonly CACHE_PREFIX = 'mapdata:';
	private readonly CACHE_TTL: number;
	private readonly GEOCODE_CACHE_TTL = 86400000; // 24 hours

	constructor(
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectRepository(Competitor)
		private competitorRepository: Repository<Competitor>,
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		@InjectRepository(Branch)
		private branchRepository: Repository<Branch>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(CheckIn)
		private checkInRepository: Repository<CheckIn>,
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		@InjectRepository(Journal)
		private journalRepository: Repository<Journal>,
		@InjectRepository(Lead)
		private leadRepository: Repository<Lead>,
		@InjectRepository(Tracking)
		private trackingRepository: Repository<Tracking>,
		@InjectRepository(Claim)
		private claimRepository: Repository<Claim>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private googleMapsService: GoogleMapsService,
		private trackingService: TrackingService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 300;
		this.logger.log(`MapDataReportGenerator initialized with cache TTL: ${this.CACHE_TTL}ms`);
	}

	private getCacheKey(organisationId: number, branchId?: number, userId?: number): string {
		return `${this.CACHE_PREFIX}org${organisationId}_${branchId || 'all'}_${userId || 'all'}`;
	}

	private async getCachedGeocode(latitude: number, longitude: number): Promise<string | null> {
		const roundedLat = Math.round(latitude * 10000) / 10000;
		const roundedLng = Math.round(longitude * 10000) / 10000;
		const cacheKey = `geocode:${roundedLat}_${roundedLng}`;
		return await this.cacheManager.get<string>(cacheKey);
	}

	private async setCachedGeocode(latitude: number, longitude: number, address: string): Promise<void> {
		const roundedLat = Math.round(latitude * 10000) / 10000;
		const roundedLng = Math.round(longitude * 10000) / 10000;
		const cacheKey = `geocode:${roundedLat}_${roundedLng}`;
		await this.cacheManager.set(cacheKey, address, this.GEOCODE_CACHE_TTL);
	}

	async generate(params: MapDataRequestParams): Promise<Record<string, any>> {
		const cacheKey = this.getCacheKey(params.organisationId, params.branchId, params.userId);
		
		const cached = await this.cacheManager.get<Record<string, any>>(cacheKey);
		if (cached) {
			this.logger.debug(`Cache hit for map data: ${cacheKey}`);
			return cached;
		}

		const startTime = new Date();
		this.logger.log(`Starting map data generation for organisation ${params.organisationId}${params.branchId ? `, branch ${params.branchId}` : ''}${params.userId ? `, user ${params.userId}` : ''}`);
		
		try {
			const { organisationId, branchId, userId } = params;
			
			// Input validation with logging
			this.logger.debug('Validating input parameters');
			if (!organisationId || organisationId <= 0) {
				this.logger.error(`Invalid organisation ID provided: ${organisationId}`);
				throw new Error('Invalid organisation ID provided');
			}
			
			if (branchId && branchId <= 0) {
				this.logger.error(`Invalid branch ID provided: ${branchId}`);
				throw new Error('Invalid branch ID provided');
			}

			// Verify organization exists and user has access
			this.logger.debug(`Verifying organisation ${organisationId} exists and is active`);
			const organisation = await this.organisationRepository.findOne({ 
				where: { uid: organisationId },
				select: ['uid', 'name', 'status', 'clerkOrgId']
			});
			
			if (!organisation) {
				this.logger.error(`Organisation ${organisationId} not found`);
				throw new Error('Organisation not found or access denied');
			}

			if (organisation.status !== GeneralStatus.ACTIVE) {
				this.logger.error(`Organisation ${organisationId} is not active. Status: ${organisation.status}`);
				throw new Error('Organisation is not active');
			}

			if (!organisation.clerkOrgId) {
				this.logger.error(`Organisation ${organisationId} has no Clerk org ID`);
				throw new Error('Organisation has no Clerk org ID');
			}

			this.logger.log(`Organisation verified: ${organisation.name} (${organisation.uid})`);

			// If branchId is provided, verify it belongs to the organization
			if (branchId) {
				this.logger.debug(`Verifying branch ${branchId} belongs to organisation ${organisationId}`);
				const branch = await this.branchRepository.findOne({
					where: { 
						uid: branchId, 
						organisation: { uid: organisationId } 
					},
					select: ['uid', 'name']
				});
				
				if (!branch) {
					this.logger.error(`Branch ${branchId} not found or does not belong to organisation ${organisationId}`);
					throw new Error('Branch not found or does not belong to the specified organisation');
				}
				
				this.logger.log(`Branch verified: ${branch.name} (${branch.uid})`);
			}

			// ---------- COMPREHENSIVE DATA VALIDATION ----------
			this.logger.debug('Performing comprehensive data validation queries...');
			
			// Test attendance data availability
			const totalAttendanceCount = await this.attendanceRepository.count({
				where: { organisation: { uid: organisationId } }
			});
			this.logger.log(`📊 Total attendance records in DB for org ${organisationId}: ${totalAttendanceCount}`);
			
			// Test quotation data availability  
			const totalQuotationCount = await this.quotationRepository.count({
				where: { organisation: { uid: organisationId } }
			});
			this.logger.log(`📊 Total quotations in DB for org ${organisationId}: ${totalQuotationCount}`);
			
			// Test lead data availability (Lead.organisationUid references Organisation.clerkOrgId)
			const totalLeadCount = await this.leadRepository.count({
				where: { organisationUid: organisation.clerkOrgId, isDeleted: false }
			});
			this.logger.log(`📊 Total leads in DB for org ${organisationId}: ${totalLeadCount}`);
			
			// Test task data availability
			const totalTaskCount = await this.taskRepository.count({
				where: { organisation: { uid: organisationId } }
			});
			this.logger.log(`📊 Total tasks in DB for org ${organisationId}: ${totalTaskCount}`);

			const todayStart = startOfDay(new Date());
			const yesterdayStart = startOfDay(subDays(new Date(), 1));
			
			this.logger.debug(`Date range for queries: Today start: ${todayStart.toISOString()}, Yesterday start: ${yesterdayStart.toISOString()}`);

			// ---------- PARALLEL DATA FETCHING ----------
			this.logger.debug('Fetching all data in parallel');
			const [
				activeAttendance,
				recentAttendance,
				clients,
				competitors,
				quotationsRaw,
				leads,
				journals,
				checkIns,
				tasks,
				claims,
			] = await Promise.all([
				// Active attendance
				this.attendanceRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
					// Remove date restriction to get current active attendance regardless of when it started
					// checkIn: MoreThanOrEqual(todayStart), // Removed - was too restrictive
					checkOut: IsNull(), // Still present (not checked out)
				},
				relations: ['owner', 'branch', 'organisation'],
				}),
				// Recent attendance
				this.attendanceRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					checkIn: MoreThanOrEqual(subDays(new Date(), 7)),
				},
					relations: ['owner', 'branch', 'organisation'],
				order: { checkIn: 'DESC' },
					take: 100,
				}),
				// Clients
				this.clientRepository.find({
					where: {
						organisation: { uid: organisationId },
						...(branchId ? { branch: { uid: branchId } } : {}),
						latitude: Not(IsNull()),
						longitude: Not(IsNull()),
					},
					relations: ['assignedSalesRep'],
					select: [
						'uid', 'name', 'latitude', 'longitude', 'address', 'status',
						'contactPerson', 'email', 'phone', 'alternativePhone', 'website',
						'logo', 'description', 'industry', 'companySize', 'annualRevenue',
						'creditLimit', 'outstandingBalance', 'lifetimeValue', 'priceTier',
						'riskLevel', 'satisfactionScore', 'npsScore', 'preferredContactMethod',
						'preferredPaymentMethod', 'paymentTerms', 'discountPercentage',
						'lastVisitDate', 'nextContactDate', 'acquisitionChannel', 'acquisitionDate',
						'birthday', 'anniversaryDate', 'tags', 'visibleCategories',
						'socialMedia', 'customFields', 'geofenceType', 'geofenceRadius',
						'enableGeofence', 'createdAt', 'updatedAt'
					],
				}),
				// Competitors
				this.competitorRepository.find({
					where: {
						organisation: { uid: organisationId },
						...(branchId ? { branch: { uid: branchId } } : {}),
						latitude: Not(IsNull()),
						longitude: Not(IsNull()),
					},
					relations: ['createdBy'],
					select: [
						'uid', 'name', 'latitude', 'longitude', 'address', 'status',
						'description', 'website', 'contactEmail', 'contactPhone', 'logoUrl',
						'industry', 'marketSharePercentage', 'estimatedAnnualRevenue',
						'estimatedEmployeeCount', 'threatLevel', 'competitiveAdvantage',
						'isDirect', 'foundedDate', 'keyProducts', 'keyStrengths', 'keyWeaknesses',
						'pricingData', 'businessStrategy', 'marketingStrategy', 'socialMedia',
						'competitorRef', 'geofenceType', 'geofenceRadius', 'enableGeofence',
						'createdAt', 'updatedAt'
					],
				}),
				// Quotations
				this.quotationRepository.find({
					where: {
						organisation: { uid: organisationId },
						...(branchId ? { branch: { uid: branchId } } : {}),
					},
					relations: ['client', 'branch', 'organisation'],
					select: ['uid', 'totalAmount', 'status', 'quotationNumber', 'createdAt'],
					take: 1000,
				}),
				// Leads (Lead.organisationUid references Organisation.clerkOrgId)
				this.leadRepository.find({
					where: {
						organisationUid: organisation.clerkOrgId,
						...(branchId ? { branchUid: branchId } : {}),
						isDeleted: false,
					},
					relations: ['owner', 'client', 'interactions'],
					select: [
						'uid', 'name', 'companyName', 'email', 'phone', 'latitude', 'longitude',
						'category', 'notes', 'status', 'image', 'attachments', 'intent',
						'userQualityRating', 'temperature', 'source', 'priority', 'lifecycleStage',
						'jobTitle', 'decisionMakerRole', 'industry', 'businessSize', 'budgetRange',
						'purchaseTimeline', 'preferredCommunication', 'timezone', 'bestContactTime',
						'leadScore', 'lastContactDate', 'nextFollowUpDate', 'totalInteractions',
						'averageResponseTime', 'daysSinceLastResponse', 'painPoints', 'estimatedValue',
						'competitorInfo', 'referralSource', 'campaignName', 'landingPage',
						'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent',
						'scoringData', 'activityData', 'bantQualification', 'sourceTracking',
						'competitorData', 'customFields', 'createdAt', 'updatedAt', 'assignees',
						'changeHistory'
					],
				}),
				// Journals
				this.journalRepository.find({
					where: {
						organisation: { uid: organisationId },
						...(branchId ? { branch: { uid: branchId } } : {}),
						isDeleted: false,
						createdAt: MoreThanOrEqual(subDays(new Date(), 30)),
					},
					relations: ['owner', 'branch', 'organisation'],
					order: { createdAt: 'DESC' },
					take: 200,
				}),
				// CheckIns (table column is organisationUid = Clerk org ID string, not organisationId)
				this.checkInRepository.find({
					where: {
						organisationUid: organisation.clerkOrgId,
						...(branchId ? { branch: { uid: branchId } } : {}),
					},
					relations: ['owner', 'client', 'branch', 'organisation'],
					take: 200,
				}),
				// Tasks
				this.taskRepository.find({
					where: {
						organisation: { uid: organisationId },
						...(branchId ? { branch: { uid: branchId } } : {}),
						updatedAt: MoreThanOrEqual(subDays(new Date(), 30)),
					},
					relations: ['creator', 'branch', 'organisation'],
					order: { updatedAt: 'DESC' },
					take: 200,
				}),
				// Claims
				this.claimRepository.find({
					where: {
						organisation: { uid: organisationId },
						...(branchId ? { branch: { uid: branchId } } : {}),
						isDeleted: false,
					},
					relations: ['owner', 'branch', 'organisation'],
					order: { createdAt: 'DESC' },
					take: 200,
				}),
			]);

			this.logger.log(`Fetched: ${activeAttendance.length} active, ${recentAttendance.length} recent attendance, ${clients.length} clients, ${competitors.length} competitors, ${quotationsRaw.length} quotations, ${leads.length} leads, ${journals.length} journals, ${checkIns.length} checkIns, ${tasks.length} tasks, ${claims.length} claims`);

			// Helper function to reverse geocode coordinates with caching
			const geocodeLocation = async (latitude: number, longitude: number, fallback: string): Promise<string> => {
				if (!latitude || !longitude) return fallback;
				
				const cachedAddress = await this.getCachedGeocode(latitude, longitude);
				if (cachedAddress) {
					return cachedAddress;
				}

				try {
					const geocodingResult = await this.googleMapsService.reverseGeocode({
						latitude: Number(latitude),
						longitude: Number(longitude)
					});
					const address = geocodingResult.formattedAddress || fallback;
					await this.setCachedGeocode(latitude, longitude, address);
					return address;
				} catch (error) {
					this.logger.debug(`Failed to geocode location ${latitude}, ${longitude}: ${error.message}`);
					return fallback;
				}
			};

			// Initialize allMarkers array to collect all markers
			const allMarkers: any[] = [];

			// Process active attendance (check-ins)
			const workers = await Promise.all(
				activeAttendance
				.filter((a) => {
					const hasLocation = a.checkInLatitude && a.checkInLongitude;
					if (!hasLocation) {
						this.logger.debug(`Excluding attendance record ${a.uid} - missing location data`);
					}
					return hasLocation;
				})
					.map(async (a) => {
					this.logger.debug(`Mapping active worker data for ${a.owner?.name} (${a.owner?.uid})`);
						
						// Reverse geocode check-in location
						const address = await geocodeLocation(
							Number(a.checkInLatitude),
							Number(a.checkInLongitude),
							a.checkInNotes || 'Unknown Location'
						);

					return {
						id: `attendance-${a.uid}`,
						name: a.owner?.name || 'Unknown Worker',
						position: [Number(a.checkInLatitude), Number(a.checkInLongitude)] as [number, number],
						latitude: Number(a.checkInLatitude),
						longitude: Number(a.checkInLongitude),
						markerType: 'check-in',
						status: this.getWorkerStatusDisplay(a.status),
						checkInTime: a.checkIn?.toISOString(),
						checkOutTime: a.checkOut?.toISOString(),
						duration: a.duration,
							image: a.owner?.photoURL || a.owner?.avatar || undefined,
							phone: a.owner?.phone || undefined,
						location: {
								address: address,
							imageUrl: undefined,
						},
						schedule: {
							current: this.formatWorkingHours(a.checkIn),
							next: 'TBD',
						},
						canAddTask: true,
						activity: {
							claims: 0,
							journals: 0,
							leads: 0,
							checkIns: 1,
							tasks: 0,
							quotations: 0,
						},
						// Enhanced attendance data
						attendanceData: {
							uid: a.uid,
							status: a.status,
							checkInLatitude: a.checkInLatitude,
							checkInLongitude: a.checkInLongitude,
							checkOutLatitude: a.checkOutLatitude,
							checkOutLongitude: a.checkOutLongitude,
							checkInNotes: a.checkInNotes,
							checkOutNotes: a.checkOutNotes,
							breakStartTime: a.breakStartTime,
							breakEndTime: a.breakEndTime,
							totalBreakTime: a.totalBreakTime,
							breakCount: a.breakCount,
							breakDetails: a.breakDetails,
							breakLatitude: a.breakLatitude,
							breakLongitude: a.breakLongitude,
							breakNotes: a.breakNotes,
							verifiedAt: a.verifiedAt,
							verifiedBy: a.verifiedBy,
							branch: a.branch ? {
								uid: a.branch.uid,
								name: a.branch.name
							} : null
							},
							owner: a.owner ? {
								uid: a.owner.uid,
								name: a.owner.name,
								phone: a.owner.phone,
								photoURL: a.owner.photoURL || a.owner.avatar
							} : null
						};
					})
			);
			
			allMarkers.push(...workers);

			// Process shift start markers
			const shiftStartMarkers = await Promise.all(
				recentAttendance
				.filter((a) => a.checkInLatitude && a.checkInLongitude && 
					a.checkIn >= yesterdayStart && !a.checkOut)
					.map(async (a) => {
						// Reverse geocode the check-in location
						const address = await geocodeLocation(
							Number(a.checkInLatitude),
							Number(a.checkInLongitude),
							a.checkInNotes || 'Shift Start Location'
						);

						return {
					id: `shift-start-${a.uid}`,
					name: `${a.owner?.name || 'Unknown'} - Shift Start`,
					position: [Number(a.checkInLatitude), Number(a.checkInLongitude)] as [number, number],
					latitude: Number(a.checkInLatitude),
					longitude: Number(a.checkInLongitude),
					markerType: 'shift-start',
					status: 'Shift Started',
					timestamp: a.checkIn?.toISOString(),
							image: a.owner?.photoURL || a.owner?.avatar || undefined,
							phone: a.owner?.phone || undefined,
					location: {
								address: address,
						imageUrl: undefined,
					},
					attendanceData: {
						uid: a.uid,
						status: a.status,
						checkInTime: a.checkIn,
						branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
							},
							owner: a.owner ? {
								uid: a.owner.uid,
								name: a.owner.name,
								phone: a.owner.phone,
								photoURL: a.owner.photoURL || a.owner.avatar
							} : null
						};
					})
			);

			allMarkers.push(...shiftStartMarkers);

			// Process shift end markers
			const shiftEndMarkers = await Promise.all(
				recentAttendance
				.filter((a) => a.checkOutLatitude && a.checkOutLongitude && a.checkOut)
					.map(async (a) => {
						// Reverse geocode the check-out location
						const address = await geocodeLocation(
							Number(a.checkOutLatitude),
							Number(a.checkOutLongitude),
							a.checkOutNotes || 'Shift End Location'
						);

						return {
					id: `shift-end-${a.uid}`,
					name: `${a.owner?.name || 'Unknown'} - Shift End`,
					position: [Number(a.checkOutLatitude), Number(a.checkOutLongitude)] as [number, number],
					latitude: Number(a.checkOutLatitude),
					longitude: Number(a.checkOutLongitude),
					markerType: 'shift-end',
					status: 'Shift Ended',
					timestamp: a.checkOut?.toISOString(),
					duration: a.duration,
							image: a.owner?.photoURL || a.owner?.avatar || undefined,
							phone: a.owner?.phone || undefined,
					location: {
								address: address,
						imageUrl: undefined,
					},
					attendanceData: {
						uid: a.uid,
						status: a.status,
						checkInTime: a.checkIn,
						checkOutTime: a.checkOut,
						duration: a.duration,
						branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
							},
							owner: a.owner ? {
								uid: a.owner.uid,
								name: a.owner.name,
								phone: a.owner.phone,
								photoURL: a.owner.photoURL || a.owner.avatar
							} : null
						};
					})
			);

			allMarkers.push(...shiftEndMarkers);

			// Process break start markers
			const breakStartMarkers = await Promise.all(
				recentAttendance
				.filter((a) => a.breakLatitude && a.breakLongitude && a.breakStartTime && !a.breakEndTime)
					.map(async (a) => {
						// Reverse geocode the break location
						const address = await geocodeLocation(
							Number(a.breakLatitude),
							Number(a.breakLongitude),
							a.breakNotes || 'Break Location'
						);

						return {
					id: `break-start-${a.uid}`,
					name: `${a.owner?.name || 'Unknown'} - Break Start`,
					position: [Number(a.breakLatitude), Number(a.breakLongitude)] as [number, number],
					latitude: Number(a.breakLatitude),
					longitude: Number(a.breakLongitude),
					markerType: 'break-start',
					status: 'On Break',
					timestamp: a.breakStartTime?.toISOString(),
							image: a.owner?.photoURL || a.owner?.avatar || undefined,
							phone: a.owner?.phone || undefined,
					location: {
								address: address,
						imageUrl: undefined,
					},
					attendanceData: {
						uid: a.uid,
						breakStartTime: a.breakStartTime,
						breakCount: a.breakCount,
						breakNotes: a.breakNotes,
						branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
							},
							owner: a.owner ? {
								uid: a.owner.uid,
								name: a.owner.name,
								phone: a.owner.phone,
								photoURL: a.owner.photoURL || a.owner.avatar
							} : null
						};
					})
			);

			allMarkers.push(...breakStartMarkers);

			// Process break end markers
			const breakEndMarkers = await Promise.all(
				recentAttendance
					.filter((a) => a.breakLatitude && a.breakLongitude && a.breakEndTime)
					.map(async (a) => {
						// Reverse geocode the break end location
						const address = await geocodeLocation(
							Number(a.breakLatitude),
							Number(a.breakLongitude),
							a.breakNotes || 'Break End Location'
						);

						return {
							id: `break-end-${a.uid}`,
							name: `${a.owner?.name || 'Unknown'} - Break End`,
							position: [Number(a.breakLatitude), Number(a.breakLongitude)] as [number, number],
							latitude: Number(a.breakLatitude),
							longitude: Number(a.breakLongitude),
							markerType: 'break-end',
							status: 'Break Ended',
							timestamp: a.breakEndTime?.toISOString(),
							totalBreakTime: a.totalBreakTime,
							image: a.owner?.photoURL || a.owner?.avatar || undefined,
							phone: a.owner?.phone || undefined,
							location: {
								address: address,
								imageUrl: undefined,
							},
							attendanceData: {
								uid: a.uid,
								breakStartTime: a.breakStartTime,
								breakEndTime: a.breakEndTime,
								totalBreakTime: a.totalBreakTime,
								breakDetails: a.breakDetails,
								branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
							},
							owner: a.owner ? {
								uid: a.owner.uid,
								name: a.owner.name,
								phone: a.owner.phone,
								photoURL: a.owner.photoURL || a.owner.avatar
							} : null
						};
					})
			);

			allMarkers.push(...breakEndMarkers);
			
			this.logger.log(`Processed ${workers.length} workers, ${shiftStartMarkers.length} shift starts, ${shiftEndMarkers.length} shift ends, ${breakStartMarkers.length} break starts, ${breakEndMarkers.length} break ends`);

			// ---------- CLIENTS (Enhanced with comprehensive data) ----------
			this.logger.debug('Processing client data with location information');
			// Note: clients are already fetched in Promise.all above, filtering for location data
			const clientsWithLocation = clients.filter(c => c.latitude && c.longitude);
			this.logger.log(`Found ${clientsWithLocation.length} clients with location data out of ${clients.length} total`);

			const clientMarkers = clientsWithLocation.map((c) => {
				this.logger.debug(`Mapping client data for ${c.name} (${c.uid})`);
				return {
					id: c.uid,
					name: c.name,
					position: [Number(c.latitude), Number(c.longitude)] as [number, number],
					latitude: Number(c.latitude),
					longitude: Number(c.longitude),
					address: c.address,
					clientRef: c.uid.toString(),
					status: c.status ?? 'active',
					markerType: 'client',
					// Enhanced client data
					contactName: c.contactPerson,
					phone: c.phone,
					alternativePhone: c.alternativePhone,
					email: c.email,
					website: c.website,
					logo: c.logo,
					logoUrl: c.logo, // Alias for consistency
					description: c.description,
					industry: c.industry,
					companySize: c.companySize,
					annualRevenue: c.annualRevenue,
					creditLimit: c.creditLimit,
					outstandingBalance: c.outstandingBalance,
					lifetimeValue: c.lifetimeValue,
					priceTier: c.priceTier,
					riskLevel: c.riskLevel,
					satisfactionScore: c.satisfactionScore,
					npsScore: c.npsScore,
					preferredContactMethod: c.preferredContactMethod,
					preferredPaymentMethod: c.preferredPaymentMethod,
					paymentTerms: c.paymentTerms,
					discountPercentage: c.discountPercentage,
					lastVisitDate: c.lastVisitDate,
					nextContactDate: c.nextContactDate,
					acquisitionChannel: c.acquisitionChannel,
					acquisitionDate: c.acquisitionDate,
					birthday: c.birthday,
					anniversaryDate: c.anniversaryDate,
					tags: c.tags,
					visibleCategories: c.visibleCategories,
					socialProfiles: c.socialMedia, // Map to expected field name
					socialMedia: c.socialMedia,
					customFields: c.customFields,
					assignedSalesRep: c.assignedSalesRep ? {
						uid: c.assignedSalesRep.uid,
						name: (c.assignedSalesRep as any).name
					} : null,
					geofencing: {
						enabled: c.enableGeofence,
						type: c.geofenceType,
						radius: c.geofenceRadius
					},
					createdAt: c.createdAt,
					updatedAt: c.updatedAt
				};
			});

			allMarkers.push(...clientMarkers);
			
			this.logger.log(`Processed ${clientMarkers.length} client markers`);

			// ---------- LEADS (Comprehensive lead tracking with status and stages) ----------
			this.logger.debug('Processing comprehensive leads data with location information');
			// Note: leads are already fetched in Promise.all above
			this.logger.log(`Found ${leads.length} leads total for organization ${organisationId}`);

			// Filter leads with location data
			const leadsWithLocation = leads.filter(lead => lead.latitude && lead.longitude);

			this.logger.log(`Found ${leadsWithLocation.length} leads with location data out of ${leads.length} total leads`);

			const leadMarkers = leadsWithLocation.map((lead) => {
				this.logger.debug(`Mapping lead data for ${lead.companyName || lead.name} (${lead.uid})`);
				return {
					id: `lead-${lead.uid}`,
					name: lead.companyName || lead.name || 'Unknown Lead',
					position: [Number(lead.latitude), Number(lead.longitude)] as [number, number],
					latitude: Number(lead.latitude),
					longitude: Number(lead.longitude),
					markerType: 'lead',
					status: lead.status || 'PENDING',
					timestamp: lead.createdAt?.toISOString(),
					// Enhanced lead data
					leadData: {
						uid: lead.uid,
						companyName: lead.companyName,
						contactName: lead.name,
						email: lead.email,
						phone: lead.phone,
						category: lead.category,
						notes: lead.notes,
						status: lead.status,
						image: lead.image,
						attachments: lead.attachments,
						intent: lead.intent,
						userQualityRating: lead.userQualityRating,
						temperature: lead.temperature,
						source: lead.source,
						priority: lead.priority,
						lifecycleStage: lead.lifecycleStage,
						jobTitle: lead.jobTitle,
						decisionMakerRole: lead.decisionMakerRole,
						industry: lead.industry,
						businessSize: lead.businessSize,
						budgetRange: lead.budgetRange,
						purchaseTimeline: lead.purchaseTimeline,
						preferredCommunication: lead.preferredCommunication,
						timezone: lead.timezone,
						bestContactTime: lead.bestContactTime,
						leadScore: lead.leadScore,
						lastContactDate: lead.lastContactDate,
						nextFollowUpDate: lead.nextFollowUpDate,
						totalInteractions: lead.totalInteractions,
						averageResponseTime: lead.averageResponseTime,
						daysSinceLastResponse: lead.daysSinceLastResponse,
						painPoints: lead.painPoints,
						estimatedValue: lead.estimatedValue,
						competitorInfo: lead.competitorInfo,
						referralSource: lead.referralSource,
						campaignName: lead.campaignName,
						landingPage: lead.landingPage,
						utmSource: lead.utmSource,
						utmMedium: lead.utmMedium,
						utmCampaign: lead.utmCampaign,
						utmTerm: lead.utmTerm,
						utmContent: lead.utmContent,
						scoringData: lead.scoringData,
						activityData: lead.activityData,
						bantQualification: lead.bantQualification,
						sourceTracking: lead.sourceTracking,
						competitorData: lead.competitorData,
						customFields: lead.customFields,
						assignees: lead.assignees,
						changeHistory: lead.changeHistory,
						createdAt: lead.createdAt,
						updatedAt: lead.updatedAt
					},
					location: {
						address: lead.notes || 'Lead Location',
						imageUrl: lead.image,
					},
					owner: lead.owner ? {
						uid: lead.owner.uid,
						name: lead.owner.name
					} : null,
					client: lead.client ? {
						uid: lead.client.uid,
						name: lead.client.name
					} : null,
					interactionCount: lead.interactions?.length || 0
				};
			});

			allMarkers.push(...leadMarkers);
			
			this.logger.log(`Processed ${leadMarkers.length} lead markers`);

			// ---------- COMPETITORS (Enhanced with comprehensive data) ----------
			this.logger.debug('Processing competitor data with location information');
			// Note: competitors are already fetched in Promise.all above
			this.logger.log(`Found ${competitors.length} competitors total for organization ${organisationId}`);

			// Filter competitors with valid location data and map them
			const competitorsWithLocation = competitors.filter(c => c.latitude && c.longitude);
			const competitorsWithoutLocation = competitors.filter(c => !c.latitude || !c.longitude);
			this.logger.log(`Found ${competitorsWithLocation.length} competitors with location data out of ${competitors.length} total competitors`);
			this.logger.log(`Found ${competitorsWithoutLocation.length} competitors without location data - these will be excluded from map display`);

			const competitorMarkers = competitorsWithLocation.map((c) => {
				this.logger.debug(`Mapping competitor data for ${c.name} (${c.uid})`);
				return {
					id: c.uid,
					name: c.name,
					position: [Number(c.latitude), Number(c.longitude)] as [number, number],
					latitude: Number(c.latitude),
					longitude: Number(c.longitude),
					address: c.address,
					industry: c.industry,
					competitorRef: c.competitorRef || c.uid.toString(),
					status: c.status ?? 'active',
					markerType: 'competitor',
					// Enhanced competitor data
					description: c.description,
					website: c.website,
					contactEmail: c.contactEmail,
					contactPhone: c.contactPhone,
					logoUrl: c.logoUrl,
					marketSharePercentage: c.marketSharePercentage,
					estimatedAnnualRevenue: c.estimatedAnnualRevenue,
					estimatedEmployeeCount: c.estimatedEmployeeCount,
					threatLevel: c.threatLevel,
					competitiveAdvantage: c.competitiveAdvantage,
					isDirect: c.isDirect,
					foundedDate: c.foundedDate,
					keyProducts: c.keyProducts,
					keyStrengths: c.keyStrengths,
					keyWeaknesses: c.keyWeaknesses,
					pricingData: c.pricingData,
					businessStrategy: c.businessStrategy,
					marketingStrategy: c.marketingStrategy,
					socialMedia: c.socialMedia,
					geofencing: {
						enabled: c.enableGeofence,
						type: c.geofenceType,
						radius: c.geofenceRadius
					},
					createdBy: c.createdBy ? {
						uid: c.createdBy.uid,
						name: (c.createdBy as any).name
					} : null,
					createdAt: c.createdAt,
					updatedAt: c.updatedAt
				};
			});

			allMarkers.push(...competitorMarkers);
			
			this.logger.log(`Processed ${competitorMarkers.length} competitor markers`);

			// ---------- JOURNAL ENTRIES (Enhanced to include more records) ----------
			this.logger.debug('Processing comprehensive journal entries');
			// Note: journals are already fetched in Promise.all above
			this.logger.log(`Found ${journals.length} journal entries`);

			// Map journal entries to markers by trying to get location from clientRef
			const journalMarkers: any[] = [];
			for (const journal of journals) {
				try {
					// Try to find the client this journal refers to
					let journalLocation = null;
					if (journal.clientRef) {
						const client = await this.clientRepository.findOne({
							where: { uid: parseInt(journal.clientRef) },
							select: ['uid', 'name', 'latitude', 'longitude', 'address']
						});
						if (client && client.latitude && client.longitude) {
							journalLocation = {
								latitude: client.latitude,
								longitude: client.longitude,
								address: client.address || 'Client Location',
								clientName: client.name
							};
						}
					}

					if (journalLocation) {
						journalMarkers.push({
							id: `journal-${journal.uid}`,
							name: `Journal - ${journalLocation.clientName}`,
							position: [Number(journalLocation.latitude), Number(journalLocation.longitude)] as [number, number],
							latitude: Number(journalLocation.latitude),
							longitude: Number(journalLocation.longitude),
							markerType: 'journal',
							status: journal.status || 'PENDING_REVIEW',
							timestamp: journal.createdAt?.toISOString(),
							location: {
								address: journalLocation.address,
								imageUrl: undefined,
							},
							journalData: {
								uid: journal.uid,
								clientRef: journal.clientRef,
								fileURL: journal.fileURL,
								comments: journal.comments,
								status: journal.status,
								timestamp: journal.timestamp,
								createdAt: journal.createdAt,
								updatedAt: journal.updatedAt,
								branch: journal.branch ? {
									uid: journal.branch.uid,
									name: journal.branch.name
								} : null
							},
							owner: journal.owner ? {
								uid: journal.owner.uid,
								name: journal.owner.name
							} : null,
							clientName: journalLocation.clientName
						});
					}
				} catch (error) {
					this.logger.debug(`Error processing journal ${journal.uid}: ${error.message}`);
				}
			}

			allMarkers.push(...journalMarkers);
			
			this.logger.log(`Processed ${journalMarkers.length} journal markers with valid locations`);

			// ---------- CHECK-IN LOCATIONS (Enhanced client visits - NOTE: Using simplified approach) ----------
			this.logger.debug('Processing check-in data (Note: CheckIn entity has limited location data)');
			// Note: checkIns are already fetched in Promise.all above
			this.logger.log(`Found ${checkIns.length} check-ins total (Note: CheckIn entity has no geolocation fields)`);

			// Note: CheckIn entity doesn't have latitude/longitude fields, so we'll try to use client location
			const checkInMarkers = checkIns
				.filter((checkIn) => {
					const hasClientLocation = checkIn.client?.latitude && checkIn.client?.longitude;
					if (!hasClientLocation) {
						this.logger.debug(`Excluding check-in ${checkIn.uid} - client has no location data`);
					}
					return hasClientLocation;
				})
				.map((checkIn) => {
					this.logger.debug(`Mapping check-in data for ${checkIn.client?.name || 'Unknown Client'} (${checkIn.uid})`);
					return {
						id: `checkin-${checkIn.uid}`,
						name: `Check-in - ${checkIn.client?.name || 'Site Visit'}`,
						position: [Number(checkIn.client.latitude), Number(checkIn.client.longitude)] as [number, number],
						latitude: Number(checkIn.client.latitude),
						longitude: Number(checkIn.client.longitude),
						markerType: 'check-in-visit',
						status: checkIn.checkOutTime ? 'Completed' : 'In Progress',
						timestamp: checkIn.checkInTime?.toString(),
						location: {
							address: checkIn.checkInLocation || 'Check-in Location',
							imageUrl: checkIn.checkInPhoto,
						},
						checkInData: {
							uid: checkIn.uid,
							checkInTime: checkIn.checkInTime,
							checkOutTime: checkIn.checkOutTime,
							duration: checkIn.duration,
							checkInPhoto: checkIn.checkInPhoto,
							checkOutPhoto: checkIn.checkOutPhoto,
							checkInLocation: checkIn.checkInLocation,
							checkOutLocation: checkIn.checkOutLocation,
							branch: checkIn.branch ? {
								uid: checkIn.branch.uid,
								name: checkIn.branch.name
							} : null
						},
						owner: checkIn.owner ? {
							uid: checkIn.owner.uid,
							name: checkIn.owner.name
						} : null,
						client: checkIn.client ? {
							uid: checkIn.client.uid,
							name: checkIn.client.name
						} : null
					};
				});

			allMarkers.push(...checkInMarkers);
			
			this.logger.log(`Processed ${checkInMarkers.length} check-in markers with valid locations`);

			// ---------- TASKS (Enhanced task assignments and completions) ----------
			this.logger.debug('Processing comprehensive task data');
			// Note: tasks are already fetched in Promise.all above
			this.logger.log(`Found ${tasks.length} tasks`);

			// Note: Tasks have clients as JSON array, need to find associated client locations
			const taskMarkers: any[] = [];
			for (const task of tasks) {
				try {
					// Tasks have clients as JSON array of {uid: number}
					if (task.clients && Array.isArray(task.clients) && task.clients.length > 0) {
						// Get the first client for location (tasks can have multiple clients)
						const firstClientUid = task.clients[0]?.uid;
						if (firstClientUid) {
							const client = await this.clientRepository.findOne({
								where: { uid: firstClientUid },
								select: ['uid', 'name', 'latitude', 'longitude', 'address']
							});
							
							if (client && client.latitude && client.longitude) {
								taskMarkers.push({
									id: `task-${task.uid}`,
									name: `Task - ${task.title}`,
									position: [Number(client.latitude), Number(client.longitude)] as [number, number],
									latitude: Number(client.latitude),
									longitude: Number(client.longitude),
									markerType: 'task',
									status: task.status || 'PENDING',
									timestamp: task.updatedAt?.toISOString(),
									location: {
										address: client.address || 'Task Location',
										imageUrl: undefined,
									},
									taskData: {
										uid: task.uid,
										title: task.title,
										description: task.description,
										status: task.status,
										priority: task.priority,
										deadline: task.deadline,
										completionDate: task.completionDate,
										progress: task.progress,
										createdAt: task.createdAt,
										updatedAt: task.updatedAt,
										assignees: task.assignees,
										clients: task.clients,
										branch: task.branch ? {
											uid: task.branch.uid,
											name: task.branch.name
										} : null
									},
									creator: task.creator ? {
										uid: task.creator.uid,
										name: task.creator.name
									} : null,
									client: {
										uid: client.uid,
										name: client.name
									}
								});
								this.logger.debug(`Mapped task ${task.title} to client ${client.name} location`);
							}
						}
					}
				} catch (error) {
					this.logger.debug(`Error processing task ${task.uid}: ${error.message}`);
				}
			}

			allMarkers.push(...taskMarkers);
			this.logger.log(`Processed ${taskMarkers.length} task markers with valid client locations`);

			// ---------- QUOTATIONS ----------
			this.logger.debug('Processing quotations data');
			const quotationsWithLocation = quotationsRaw.filter(q => q.client?.latitude && q.client?.longitude);
			const quotations = quotationsWithLocation.map((q) => ({
						id: q.uid,
						quotationNumber: (q as any).quotationNumber || q.uid.toString(),
						clientName: q.client.name,
						position: [Number(q.client.latitude), Number(q.client.longitude)] as [number, number],
						latitude: Number(q.client.latitude),
						longitude: Number(q.client.longitude),
						totalAmount: q.totalAmount,
						status: q.status,
						quotationDate: q.createdAt,
						validUntil: (q as any).expiryDate,
						markerType: 'quotation',
				placedBy: 'System',
				isConverted: false,
			}));
			allMarkers.push(...quotations);
			this.logger.log(`Processed ${quotations.length} quotations with valid client locations`);

			// ---------- CLAIMS ----------
			this.logger.debug('Processing claims data');
			const claimMarkers: any[] = [];
			for (const claim of claims) {
				try {
					if (claim.owner?.uid) {
						const ownerAttendance = await this.attendanceRepository.findOne({
							where: { owner: { uid: claim.owner.uid } },
							order: { checkIn: 'DESC' },
							select: ['checkInLatitude', 'checkInLongitude', 'checkInNotes'],
						});

						if (ownerAttendance?.checkInLatitude && ownerAttendance?.checkInLongitude) {
							const address = await geocodeLocation(
								Number(ownerAttendance.checkInLatitude),
								Number(ownerAttendance.checkInLongitude),
								ownerAttendance.checkInNotes || 'Claim Location'
							);

							claimMarkers.push({
								id: `claim-${claim.uid}`,
								name: `Claim - ${claim.claimRef || claim.uid}`,
								position: [Number(ownerAttendance.checkInLatitude), Number(ownerAttendance.checkInLongitude)] as [number, number],
								latitude: Number(ownerAttendance.checkInLatitude),
								longitude: Number(ownerAttendance.checkInLongitude),
								markerType: 'claim',
								status: claim.status,
								amount: claim.amount,
								location: { address },
								claimData: {
									uid: claim.uid,
									claimRef: claim.claimRef,
									amount: claim.amount,
									status: claim.status,
									category: claim.category,
									currency: claim.currency,
									createdAt: claim.createdAt,
								},
								owner: claim.owner ? {
									uid: claim.owner.uid,
									name: (claim.owner as any).name
								} : null,
							});
						}
					}
				} catch (error) {
					this.logger.debug(`Error processing claim ${claim.uid}: ${error.message}`);
				}
			}
			allMarkers.push(...claimMarkers);
			this.logger.log(`Processed ${claimMarkers.length} claim markers`);

			// ---------- EVENTS (Recent activities) ----------
			this.logger.debug('Generating events data from recent activities');
			const events = await this.generateRecentEvents({
				organisationId,
				organisationClerkOrgId: organisation.clerkOrgId,
				branchId,
				todayStart,
				yesterdayStart,
			});
			
			this.logger.log(`Generated ${events.length} recent events`);

			// ---------- Map Config ----------
			this.logger.debug('Determining optimal map center and configuration');
			let defaultCenter = { lat: 0, lng: 0 };
			
			// Set default center based on available data with priority: workers > clients > any marker
			if (workers.length > 0) {
				defaultCenter = { lat: workers[0].latitude, lng: workers[0].longitude };
				this.logger.debug(`Map center set to first worker location: ${defaultCenter.lat}, ${defaultCenter.lng}`);
			} else if (clientMarkers.length > 0) {
				defaultCenter = { lat: clientMarkers[0].latitude, lng: clientMarkers[0].longitude };
				this.logger.debug(`Map center set to first client location: ${defaultCenter.lat}, ${defaultCenter.lng}`);
			} else if (allMarkers.length > 0) {
				defaultCenter = { lat: allMarkers[0].latitude, lng: allMarkers[0].longitude };
				this.logger.debug(`Map center set to first available marker location: ${defaultCenter.lat}, ${defaultCenter.lng}`);
			} else {
				// Default to South Africa coordinates if no data available
				defaultCenter = { lat: -26.2041, lng: 28.0473 }; // Johannesburg, South Africa
				this.logger.debug(`No location data available, using default center: Johannesburg, SA`);
			}

			const branches = await this.branchRepository.find({
				where: { 
					organisation: { uid: organisationId },
					...(branchId ? { uid: branchId } : {})
				},
				select: ['uid', 'name', 'address'],
			});

			this.logger.debug(`Found ${branches.length} branches for organization`);

			const orgRegions: Array<{ name: string; center: { lat: number; lng: number }; zoom: number }> = [];

			// Performance logging (removed duplicate)

			// Debug: Log the composition of allMarkers before filtering
			const markerTypeCounts = allMarkers.reduce((acc, marker) => {
				const type = marker.markerType || 'unknown';
				acc[type] = (acc[type] || 0) + 1;
				return acc;
			}, {} as Record<string, number>);
			
			this.logger.log(`📊 AllMarkers composition: ${JSON.stringify(markerTypeCounts)}`);
			this.logger.log(`📊 Total allMarkers count: ${allMarkers.length}`);

			// Filter markers by type for backward compatibility and easier filtering
			const markersByType = {
				workers: allMarkers.filter(m => m.markerType === 'check-in'),
				clients: allMarkers.filter(m => m.markerType === 'client'),
				competitors: allMarkers.filter(m => m.markerType === 'competitor'),
				quotations: allMarkers.filter(m => m.markerType === 'quotation'),
				leads: allMarkers.filter(m => m.markerType === 'lead'),
				journals: allMarkers.filter(m => m.markerType === 'journal'),
				tasks: allMarkers.filter(m => m.markerType === 'task'),
				checkIns: allMarkers.filter(m => m.markerType === 'check-in-visit'),
				shiftStarts: allMarkers.filter(m => m.markerType === 'shift-start'),
				shiftEnds: allMarkers.filter(m => m.markerType === 'shift-end'),
				breakStarts: allMarkers.filter(m => m.markerType === 'break-start'),
				breakEnds: allMarkers.filter(m => m.markerType === 'break-end'),
				claims: allMarkers.filter(m => m.markerType === 'claim'),
			};
			
			// Debug: Log the filtered marker counts
			this.logger.log(`📊 Filtered marker counts - Workers: ${markersByType.workers.length}, Clients: ${markersByType.clients.length}, Competitors: ${markersByType.competitors.length}, Quotations: ${markersByType.quotations.length}, Leads: ${markersByType.leads.length}, Journals: ${markersByType.journals.length}, Tasks: ${markersByType.tasks.length}, Check-ins: ${markersByType.checkIns.length}`);
			
			// Verify that competitors and quotations are in allMarkers
			const competitorsInAll = allMarkers.filter(m => m.markerType === 'competitor');
			const quotationsInAll = allMarkers.filter(m => m.markerType === 'quotation');
			this.logger.log(`📊 Debug verification - Competitors in allMarkers: ${competitorsInAll.length}, Quotations in allMarkers: ${quotationsInAll.length}`);
			
			// ---------- ADVANCED GPS ANALYSIS AND ROUTE OPTIMIZATION ----------
			let enhancedGpsAnalysis: any = {};
			let routeOptimizations: any = {};
			
			if (params.includeGpsAnalysis || params.includeRouteOptimization) {
				this.logger.log(`🗺️  Starting advanced GPS analysis for organization ${organisationId}`);
				
				try {
					const gpsAnalysisDate = params.gpsAnalysisDate || new Date();
					
					// Get active workers with tracking data
					const workersWithTracking = activeAttendance.filter(a => a.owner?.uid);
					
					if (workersWithTracking.length > 0) {
						this.logger.log(`📍 Processing GPS analysis for ${workersWithTracking.length} active workers`);
						
						const gpsAnalysisResults = await Promise.allSettled(
							workersWithTracking.map(async (worker) => {
								try {
									// Get tracking points for this worker today
									const trackingPoints = await this.trackingRepository.find({
										where: {
											owner: { uid: worker.owner.uid },
											createdAt: MoreThanOrEqual(startOfDay(gpsAnalysisDate)),
										},
										order: { createdAt: 'ASC' },
									});
									
									if (trackingPoints.length < 2) {
										return { workerId: worker.owner.uid, analysis: null, routes: null };
									}
									
									// Use GoogleMapsService for advanced GPS analysis
									let gpsAnalysis = null;
									if (params.includeGpsAnalysis) {
										gpsAnalysis = await this.googleMapsService.analyzeGPSTrackingData(
											trackingPoints.map(tp => ({
												latitude: tp.latitude,
												longitude: tp.longitude,
												createdAt: tp.createdAt,
												address: tp.address,
											})),
											{
												minStopDurationMinutes: 5,
												maxStopRadiusMeters: 100,
												geocodeStops: false, // Already have addresses
											}
										);
									}
									
									// Route optimization for this worker's path
									let routeOptimization = null;
									if (params.includeRouteOptimization && gpsAnalysis?.stops && gpsAnalysis.stops.length > 2) {
										try {
											const stops = gpsAnalysis.stops;
											const origin = { latitude: stops[0].latitude, longitude: stops[0].longitude };
											const destinations = stops.slice(1, -1).map(stop => ({ latitude: stop.latitude, longitude: stop.longitude }));
											const destination = { latitude: stops[stops.length - 1].latitude, longitude: stops[stops.length - 1].longitude };
											
											if (destinations.length > 0 && destinations.length <= 8) { // Limit for performance
												const optimizedRoute = await this.googleMapsService.optimizeRoute(
													origin,
													[...destinations, destination],
													{
														travelMode: 'DRIVING' as any,
														avoidTolls: false,
														avoidHighways: false,
													},
													false // Don't return to origin
												);
												
												routeOptimization = {
													originalDistance: gpsAnalysis.tripSummary.totalDistanceKm,
													optimizedDistance: optimizedRoute.totalDistance / 1000, // Convert to km
													potentialSaving: Math.max(0, gpsAnalysis.tripSummary.totalDistanceKm - (optimizedRoute.totalDistance / 1000)),
													optimizedWaypointOrder: optimizedRoute.waypointOrder,
													stops: stops.length,
													recommendation: optimizedRoute.totalDistance / 1000 < gpsAnalysis.tripSummary.totalDistanceKm 
														? `Route could be optimized to save ${(gpsAnalysis.tripSummary.totalDistanceKm - (optimizedRoute.totalDistance / 1000)).toFixed(1)}km`
														: 'Current route appears well optimized'
												};
											}
										} catch (routeError) {
											this.logger.warn(`Failed to optimize route for worker ${worker.owner.uid}:`, routeError.message);
										}
									}
									
									return {
										workerId: worker.owner.uid,
										workerName: worker.owner.name,
										analysis: gpsAnalysis,
										routes: routeOptimization,
									};
								} catch (error) {
									this.logger.warn(`GPS analysis failed for worker ${worker.owner?.uid}:`, error.message);
									return { workerId: worker.owner?.uid, analysis: null, routes: null, error: error.message };
								}
							})
						);
						
						// Process results
						const successfulAnalyses = gpsAnalysisResults
							.filter(result => result.status === 'fulfilled')
							.map(result => (result as any).value)
							.filter(result => result.analysis || result.routes);
						
						if (successfulAnalyses.length > 0) {
							// Aggregate GPS analysis data
							enhancedGpsAnalysis = {
								totalWorkersAnalyzed: successfulAnalyses.length,
								totalDistanceCovered: successfulAnalyses.reduce((sum, w) => sum + (w.analysis?.tripSummary?.totalDistanceKm || 0), 0),
								totalStopsDetected: successfulAnalyses.reduce((sum, w) => sum + (w.analysis?.tripSummary?.numberOfStops || 0), 0),
								averageStopsPerWorker: successfulAnalyses.length > 0 
									? Math.round(successfulAnalyses.reduce((sum, w) => sum + (w.analysis?.tripSummary?.numberOfStops || 0), 0) / successfulAnalyses.length * 10) / 10
									: 0,
								averageSpeedKmh: successfulAnalyses.length > 0
									? Math.round(successfulAnalyses.reduce((sum, w) => sum + (w.analysis?.tripSummary?.averageSpeedKmh || 0), 0) / successfulAnalyses.length * 10) / 10
									: 0,
								maxSpeedRecorded: Math.max(...successfulAnalyses.map(w => w.analysis?.tripSummary?.maxSpeedKmh || 0)),
								workersData: successfulAnalyses.map(w => ({
									workerId: w.workerId,
									workerName: w.workerName,
									tripSummary: w.analysis?.tripSummary,
									stopsCount: w.analysis?.stops?.length || 0,
									topStops: (w.analysis?.stops || []).slice(0, 3), // Top 3 stops
								})),
							};
							
							// Route optimization aggregation
							if (params.includeRouteOptimization) {
								const workersWithRoutes = successfulAnalyses.filter(w => w.routes);
								if (workersWithRoutes.length > 0) {
									routeOptimizations = {
										totalWorkersOptimized: workersWithRoutes.length,
										totalPotentialSaving: workersWithRoutes.reduce((sum, w) => sum + (w.routes?.potentialSaving || 0), 0),
										averagePotentialSaving: workersWithRoutes.length > 0
											? Math.round(workersWithRoutes.reduce((sum, w) => sum + (w.routes?.potentialSaving || 0), 0) / workersWithRoutes.length * 100) / 100
											: 0,
										workersWithOptimizations: workersWithRoutes.map(w => ({
											workerId: w.workerId,
											workerName: w.workerName,
											optimization: w.routes,
										})),
									};
								}
							}
							
							this.logger.log(`🎯 GPS Analysis Complete: ${successfulAnalyses.length} workers analyzed, ${enhancedGpsAnalysis.totalDistanceCovered}km total distance`);
						}
					}
				} catch (gpsError) {
					this.logger.error('GPS analysis failed:', gpsError.message);
				}
			}
			
			const executionTime = new Date().getTime() - startTime.getTime();
			
			const finalData = {
				workers: markersByType.workers,
				clients: markersByType.clients,
				competitors: markersByType.competitors,
				quotations: markersByType.quotations,
				leads: markersByType.leads,
				journals: markersByType.journals,
				tasks: markersByType.tasks,
				checkIns: markersByType.checkIns,
				shiftStarts: markersByType.shiftStarts,
				shiftEnds: markersByType.shiftEnds,
				breakStarts: markersByType.breakStarts,
				breakEnds: markersByType.breakEnds,
				claims: markersByType.claims,
				allMarkers: allMarkers,
				events,
				mapConfig: {
					defaultCenter,
					orgRegions,
				},
				gpsAnalysis: enhancedGpsAnalysis,
				routeOptimizations: routeOptimizations,
				analytics: {
					totalMarkers: allMarkers.length,
					markerBreakdown: markersByType,
					gpsInsights: enhancedGpsAnalysis,
					routeInsights: routeOptimizations,
				},
			};
			
			this.logger.log(`Map data generation completed successfully in ${executionTime}ms`);
			this.logger.log(`Summary - Total markers: ${allMarkers.length}, Claims: ${markersByType.claims.length}`);
			
			await this.cacheManager.set(cacheKey, finalData, this.CACHE_TTL);
			this.logger.log(`Map data cached: ${cacheKey}`);
			
			return finalData;
		} catch (error) {
			// Performance logging for failed requests
			const endTime = new Date();
			const executionTime = endTime.getTime() - startTime.getTime();
			
			// Log the error with context
			this.logger.error(
				`Error generating map data for organisation ${params.organisationId}${params.branchId ? ` and branch ${params.branchId}` : ''} after ${executionTime}ms: ${error.message}`, 
				error.stack
			);
			
			// Re-throw with appropriate error type
			if (error.message.includes('not found') || error.message.includes('access denied') || error.message.includes('does not belong')) {
				throw new Error(`Access denied: ${error.message}`);
			}
			
			if (error.message.includes('Invalid') || error.message.includes('not active')) {
				throw new Error(`Bad request: ${error.message}`);
			}
			
			// Generic error for other cases
			throw new Error('Failed to generate map data. Please try again later.');
		}
	}

	/**
	 * Generate recent events from various activities in the organization
	 */
	private async generateRecentEvents(params: {
		organisationId: number;
		organisationClerkOrgId: string;
		branchId?: number;
		todayStart: Date;
		yesterdayStart: Date;
	}): Promise<any[]> {
		const { organisationId, organisationClerkOrgId, branchId, todayStart, yesterdayStart } = params;
		const events: any[] = [];

		try {
			this.logger.debug('Fetching recent check-ins for events');
			// Recent check-ins - use organisationUid (Clerk org ID); CheckIn table has organisationUid, not organisationId
			const recentCheckIns = await this.checkInRepository.find({
				where: {
					organisationUid: organisationClerkOrgId,
					...(branchId ? { branch: { uid: branchId } } : {}),
				},
				relations: ['owner', 'client'],
				take: 10,
			});

			recentCheckIns.forEach((checkIn) => {
				// Use client location since CheckIn doesn't have its own lat/lng
				if (checkIn.client?.latitude && checkIn.client?.longitude) {
					events.push({
						id: `checkin-${checkIn.uid}`,
						type: 'check-in',
						title: `Check-in at ${checkIn.client?.name || 'Location'}`,
						time: checkIn.checkInTime ? this.formatEventTime(new Date(checkIn.checkInTime)) : 'Unknown time',
						timestamp: checkIn.checkInTime ? new Date(checkIn.checkInTime).toISOString() : new Date().toISOString(),
						user: checkIn.owner?.name || 'Unknown User',
						userName: checkIn.owner?.name || 'Unknown User',
						location: {
							lat: Number(checkIn.client.latitude),
							lng: Number(checkIn.client.longitude),
							address: checkIn.checkInLocation || checkIn.client.address || 'Unknown Location',
						},
						details: `Check-in recorded at ${checkIn.client?.name || 'client location'}`,
					});
				}
			});

			this.logger.debug('Fetching recent tasks for events');
			// Recent task activities - Note: Tasks have clients and assignees as arrays
			const recentTasks = await this.taskRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					updatedAt: MoreThanOrEqual(yesterdayStart),
				},
				relations: ['creator', 'branch'], // Tasks don't have direct assignedTo/client relations
				take: 10,
				order: { updatedAt: 'DESC' },
			});

			// Process each task and handle clients/assignees arrays
			for (const task of recentTasks) {
				try {
					// Tasks have clients as JSON array of {uid: number}
					if (task.clients && Array.isArray(task.clients) && task.clients.length > 0) {
						// Get the first client for the event (tasks can have multiple clients)
						const firstClientUid = task.clients[0]?.uid;
						if (firstClientUid) {
							const client = await this.clientRepository.findOne({
								where: { uid: firstClientUid },
								select: ['uid', 'name', 'latitude', 'longitude', 'address']
							});
							
							if (client && client.latitude && client.longitude) {
								// Get assignee name from assignees array
								let assigneeName = 'Unassigned';
								if (task.assignees && Array.isArray(task.assignees) && task.assignees.length > 0) {
									// For now, just show first assignee name or count
									assigneeName = task.assignees.length === 1 
										? `Assignee (ID: ${task.assignees[0].clerkUserId})`
										: `${task.assignees.length} assignees`;
								}
								
					events.push({
						id: `task-${task.uid}`,
						type: 'task',
						title: task.title || 'Task Activity',
						time: this.formatEventTime(task.updatedAt),
						timestamp: task.updatedAt.toISOString(),
									user: assigneeName,
									userName: assigneeName,
						location: {
										lat: Number(client.latitude),
										lng: Number(client.longitude),
										address: client.address || 'Client Location',
						},
						details: task.description || 'Task activity',
					});
				}
						}
					}
				} catch (error) {
					this.logger.debug(`Error processing task ${task.uid} for events: ${error.message}`);
				}
			}

			this.logger.debug('Fetching recent journal entries for events');
			// Recent journal entries - Note: Journal uses clientRef, not direct client relation
			const recentJournals = await this.journalRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					createdAt: MoreThanOrEqual(yesterdayStart),
				},
				relations: ['owner'], // Journal doesn't have direct client relation
				take: 10,
				order: { createdAt: 'DESC' },
			});

			// Process each journal and resolve client location from clientRef
			for (const journal of recentJournals) {
				try {
					if (journal.clientRef) {
						// Try to find client by clientRef
						const client = await this.clientRepository.findOne({
							where: { uid: parseInt(journal.clientRef) },
							select: ['uid', 'name', 'latitude', 'longitude', 'address']
						});
						
						if (client && client.latitude && client.longitude) {
					events.push({
						id: `journal-${journal.uid}`,
						type: 'journal',
								title: `Journal Entry #${journal.uid}`, // Journal doesn't have title field
						time: this.formatEventTime(journal.createdAt),
						timestamp: journal.createdAt.toISOString(),
						user: journal.owner?.name || 'Unknown User',
						userName: journal.owner?.name || 'Unknown User',
						location: {
									lat: Number(client.latitude),
									lng: Number(client.longitude),
									address: client.address || 'Client Location',
								},
								details: journal.comments?.substring(0, 100) || 'Journal entry created', // Use comments field
							});
						}
					}
				} catch (error) {
					this.logger.debug(`Error processing journal ${journal.uid} for events: ${error.message}`);
				}
			}

			this.logger.debug('Fetching recent leads for events');
			// Recent leads - Lead.organisationUid references Organisation.clerkOrgId (string)
			const recentLeads = await this.leadRepository.find({
				where: {
					organisationUid: organisationClerkOrgId,
					...(branchId ? { branchUid: branchId } : {}),
					createdAt: MoreThanOrEqual(yesterdayStart),
					isDeleted: false,
				},
				relations: ['owner'],
				take: 10,
				order: { createdAt: 'DESC' },
			});

			recentLeads.forEach((lead) => {
				if (lead.latitude && lead.longitude) {
					events.push({
						id: `lead-${lead.uid}`,
						type: 'lead',
						title: `New Lead: ${lead.companyName || lead.name || 'Prospect'}`, // Use name field not contactName
						time: this.formatEventTime(lead.createdAt),
						timestamp: lead.createdAt.toISOString(),
						user: lead.owner?.name || 'Unknown User', // Use owner not createdBy
						userName: lead.owner?.name || 'Unknown User',
						location: {
							lat: Number(lead.latitude),
							lng: Number(lead.longitude),
							address: lead.notes || 'Lead Location', // Use notes field as address isn't available
						},
						details: `New lead captured: ${lead.companyName || lead.name}`, // Use name field
					});
				}
			});

			this.logger.debug('Fetching recent shift starts and ends for events');
			// Recent shift starts and ends from attendance records
			const recentAttendance = await this.attendanceRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					checkIn: MoreThanOrEqual(yesterdayStart),
				},
				relations: ['owner', 'branch', 'organisation'],
				order: { checkIn: 'DESC' },
				take: 50,
			});

			// Add shift-start events
			recentAttendance
				.filter((a) => a.checkInLatitude && a.checkInLongitude && a.checkIn)
				.forEach((a) => {
					events.push({
						id: `shift-start-${a.uid}`,
						type: 'shift-start',
						title: `Shift Started - ${a.owner?.name || 'Worker'}`,
						time: a.checkIn ? this.formatEventTime(a.checkIn) : 'Unknown time',
						timestamp: a.checkIn ? a.checkIn.toISOString() : new Date().toISOString(),
						user: a.owner?.name || 'Unknown User',
						userName: a.owner?.name || 'Unknown User',
						location: {
							lat: Number(a.checkInLatitude),
							lng: Number(a.checkInLongitude),
							address: a.checkInNotes || 'Shift Start Location',
						},
						details: `Shift started at ${a.checkInNotes || 'location'}`,
					});
				});

			// Add shift-end events
			recentAttendance
				.filter((a) => a.checkOutLatitude && a.checkOutLongitude && a.checkOut)
				.forEach((a) => {
					events.push({
						id: `shift-end-${a.uid}`,
						type: 'shift-end',
						title: `Shift Ended - ${a.owner?.name || 'Worker'}`,
						time: a.checkOut ? this.formatEventTime(a.checkOut) : 'Unknown time',
						timestamp: a.checkOut ? a.checkOut.toISOString() : new Date().toISOString(),
						user: a.owner?.name || 'Unknown User',
						userName: a.owner?.name || 'Unknown User',
						location: {
							lat: Number(a.checkOutLatitude),
							lng: Number(a.checkOutLongitude),
							address: a.checkOutNotes || 'Shift End Location',
						},
						details: `Shift ended at ${a.checkOutNotes || 'location'}`,
					});
				});

			// Sort events by timestamp (most recent first)
			events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

			// Limit to most recent 20 events
			return events.slice(0, 20);

		} catch (error) {
			this.logger.error(`Error generating events data: ${error.message}`, error.stack);
			return []; // Return empty array on error
		}
	}

	/**
	 * Get display-friendly status for workers
	 */
	private getWorkerStatusDisplay(status: string): string {
		switch (status) {
			case AttendanceStatus.PRESENT:
				return 'Work in progress';
			case AttendanceStatus.ON_BREAK:
				return 'On break';
			default:
				return status || 'Unknown';
		}
	}

	/**
	 * Format working hours display
	 */
	private formatWorkingHours(checkIn: Date): string {
		if (!checkIn) return 'Unknown';
		
		const now = new Date();
		const hours = Math.floor((now.getTime() - checkIn.getTime()) / (1000 * 60 * 60));
		const minutes = Math.floor(((now.getTime() - checkIn.getTime()) % (1000 * 60 * 60)) / (1000 * 60));
		
		return `${checkIn.toLocaleTimeString()} - Present (${hours}h ${minutes}m)`;
	}

	/**
	 * Format event time for display
	 */
	private formatEventTime(date: Date): string {
		const now = new Date();
		const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
		
		if (diffInHours < 1) {
			const minutes = Math.floor(diffInHours * 60);
			return `${minutes} minutes ago`;
		} else if (diffInHours < 24) {
			const hours = Math.floor(diffInHours);
			return `${hours} hour${hours > 1 ? 's' : ''} ago`;
		} else {
			const days = Math.floor(diffInHours / 24);
			if (days === 1) {
				return `Yesterday, ${date.toLocaleTimeString()}`;
			} else {
				return `${days} days ago`;
			}
		}
	}
}

