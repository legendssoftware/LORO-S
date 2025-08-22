import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, IsNull, In, Not } from 'typeorm';
import { startOfDay, subDays } from 'date-fns';
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

interface MapDataRequestParams {
	organisationId: number;
	branchId?: number;
	userId?: number; // Add user context for authorization
}

@Injectable()
export class MapDataReportGenerator {
	private readonly logger = new Logger(MapDataReportGenerator.name);

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
	) {}

	async generate(params: MapDataRequestParams): Promise<Record<string, any>> {
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
				select: ['uid', 'name', 'status']
			});
			
			if (!organisation) {
				this.logger.error(`Organisation ${organisationId} not found`);
				throw new Error('Organisation not found or access denied');
			}

			if (organisation.status !== GeneralStatus.ACTIVE) {
				this.logger.error(`Organisation ${organisationId} is not active. Status: ${organisation.status}`);
				throw new Error('Organisation is not active');
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
			
			// Test lead data availability
			const totalLeadCount = await this.leadRepository.count({
				where: { organisationUid: organisationId, isDeleted: false }
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

			// ---------- COMPREHENSIVE MARKER DATA COLLECTION ----------
			const allMarkers: any[] = [];

			// ---------- ATTENDANCE DATA (Check-ins, Shift Start/End, Breaks) ----------
			this.logger.debug('Fetching comprehensive attendance records');
			
			// Active attendance (current check-ins) - Enhanced query
			this.logger.debug(`Fetching active attendance for org ${organisationId}, branch ${branchId || 'all'}`);
			const activeAttendance = await this.attendanceRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
					// Remove date restriction to get current active attendance regardless of when it started
					// checkIn: MoreThanOrEqual(todayStart), // Removed - was too restrictive
					checkOut: IsNull(), // Still present (not checked out)
				},
				relations: ['owner', 'branch', 'organisation'], // Removed 'owner.profile' - doesn't exist
			});

			this.logger.log(`Found ${activeAttendance.length} active attendance records (currently checked in)`);

			// Recent attendance (for shift start/end tracking) - Enhanced query
			const recentAttendance = await this.attendanceRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					// Expand to last 7 days for better data coverage
					checkIn: MoreThanOrEqual(subDays(new Date(), 7)),
				},
				relations: ['owner', 'branch', 'organisation'], // Removed 'owner.profile' - doesn't exist
				order: { checkIn: 'DESC' },
				take: 100, // Increased from 50
			});

			this.logger.log(`Found ${recentAttendance.length} recent attendance records (last 7 days)`);

			// Process active attendance (check-ins)
			const workers = activeAttendance
				.filter((a) => {
					const hasLocation = a.checkInLatitude && a.checkInLongitude;
					if (!hasLocation) {
						this.logger.debug(`Excluding attendance record ${a.uid} - missing location data`);
					}
					return hasLocation;
				})
				.map((a) => {
					this.logger.debug(`Mapping active worker data for ${a.owner?.name} (${a.owner?.uid})`);
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
						// image: a.owner?.profile?.avatarUrl || undefined, // Removed - profile doesn't exist
						location: {
							address: a.checkInNotes || 'Unknown Location',
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
						}
					};
				});
			
			allMarkers.push(...workers);

			// Process shift start markers
			const shiftStartMarkers = recentAttendance
				.filter((a) => a.checkInLatitude && a.checkInLongitude && 
					a.checkIn >= yesterdayStart && !a.checkOut)
				.map((a) => ({
					id: `shift-start-${a.uid}`,
					name: `${a.owner?.name || 'Unknown'} - Shift Start`,
					position: [Number(a.checkInLatitude), Number(a.checkInLongitude)] as [number, number],
					latitude: Number(a.checkInLatitude),
					longitude: Number(a.checkInLongitude),
					markerType: 'shift-start',
					status: 'Shift Started',
					timestamp: a.checkIn?.toISOString(),
					// image: a.owner?.profile?.avatarUrl || undefined, // Removed - profile doesn't exist
					location: {
						address: a.checkInNotes || 'Shift Start Location',
						imageUrl: undefined,
					},
					attendanceData: {
						uid: a.uid,
						status: a.status,
						checkInTime: a.checkIn,
						branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
					}
				}));

			allMarkers.push(...shiftStartMarkers);

			// Process shift end markers
			const shiftEndMarkers = recentAttendance
				.filter((a) => a.checkOutLatitude && a.checkOutLongitude && a.checkOut)
				.map((a) => ({
					id: `shift-end-${a.uid}`,
					name: `${a.owner?.name || 'Unknown'} - Shift End`,
					position: [Number(a.checkOutLatitude), Number(a.checkOutLongitude)] as [number, number],
					latitude: Number(a.checkOutLatitude),
					longitude: Number(a.checkOutLongitude),
					markerType: 'shift-end',
					status: 'Shift Ended',
					timestamp: a.checkOut?.toISOString(),
					duration: a.duration,
					// image: a.owner?.profile?.avatarUrl || undefined, // Removed - profile doesn't exist
					location: {
						address: a.checkOutNotes || 'Shift End Location',
						imageUrl: undefined,
					},
					attendanceData: {
						uid: a.uid,
						status: a.status,
						checkInTime: a.checkIn,
						checkOutTime: a.checkOut,
						duration: a.duration,
						branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
					}
				}));

			allMarkers.push(...shiftEndMarkers);

			// Process break start markers
			const breakStartMarkers = recentAttendance
				.filter((a) => a.breakLatitude && a.breakLongitude && a.breakStartTime && !a.breakEndTime)
				.map((a) => ({
					id: `break-start-${a.uid}`,
					name: `${a.owner?.name || 'Unknown'} - Break Start`,
					position: [Number(a.breakLatitude), Number(a.breakLongitude)] as [number, number],
					latitude: Number(a.breakLatitude),
					longitude: Number(a.breakLongitude),
					markerType: 'break-start',
					status: 'On Break',
					timestamp: a.breakStartTime?.toISOString(),
					// image: a.owner?.profile?.avatarUrl || undefined, // Removed - profile doesn't exist
					location: {
						address: a.breakNotes || 'Break Location',
						imageUrl: undefined,
					},
					attendanceData: {
						uid: a.uid,
						breakStartTime: a.breakStartTime,
						breakCount: a.breakCount,
						breakNotes: a.breakNotes,
						branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
					}
				}));

			allMarkers.push(...breakStartMarkers);

			// Process break end markers
			const breakEndMarkers = recentAttendance
				.filter((a) => a.breakLatitude && a.breakLongitude && a.breakEndTime)
				.map((a) => ({
					id: `break-end-${a.uid}`,
					name: `${a.owner?.name || 'Unknown'} - Break End`,
					position: [Number(a.breakLatitude), Number(a.breakLongitude)] as [number, number],
					latitude: Number(a.breakLatitude),
					longitude: Number(a.breakLongitude),
					markerType: 'break-end',
					status: 'Break Ended',
					timestamp: a.breakEndTime?.toISOString(),
					totalBreakTime: a.totalBreakTime,
					// image: a.owner?.profile?.avatarUrl || undefined, // Removed - profile doesn't exist
					location: {
						address: a.breakNotes || 'Break End Location',
						imageUrl: undefined,
					},
					attendanceData: {
						uid: a.uid,
						breakStartTime: a.breakStartTime,
						breakEndTime: a.breakEndTime,
						totalBreakTime: a.totalBreakTime,
						breakDetails: a.breakDetails,
						branch: a.branch ? { uid: a.branch.uid, name: a.branch.name } : null
					}
				}));

			allMarkers.push(...breakEndMarkers);
			
			this.logger.log(`Processed ${workers.length} workers, ${shiftStartMarkers.length} shift starts, ${shiftEndMarkers.length} shift ends, ${breakStartMarkers.length} break starts, ${breakEndMarkers.length} break ends`);

			// ---------- CLIENTS (Enhanced with comprehensive data) ----------
			this.logger.debug('Fetching client data with location information');
			const clients = await this.clientRepository.find({
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
			});

			this.logger.log(`Found ${clients.length} clients with location data`);

			const clientMarkers = clients.map((c) => {
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
			this.logger.debug('Fetching comprehensive leads data with location information');
			const leads = await this.leadRepository.find({
				where: {
					organisationUid: organisationId,
					...(branchId ? { branchUid: branchId } : {}),
					isDeleted: false,
					// Remove restrictive date filter to get all leads
					// createdAt: MoreThanOrEqual(subDays(new Date(), 30)), // Removed - was too restrictive
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
			});

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
			this.logger.debug('Fetching competitor data with location information');
			
			// First, get total competitor count for debugging
			const totalCompetitorCount = await this.competitorRepository.count({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
				}
			});
			this.logger.log(`📊 Total competitors in DB for org ${organisationId}: ${totalCompetitorCount}`);
			
			const competitors = await this.competitorRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					// Remove overly restrictive location filter - let's get all competitors first
					// latitude: Not(IsNull()),
					// longitude: Not(IsNull()),
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
			});

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
			this.logger.debug('Fetching comprehensive journal entries with expanded date range');
			const journals = await this.journalRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					isDeleted: false,
					// Expand date range to get more journal entries
					createdAt: MoreThanOrEqual(subDays(new Date(), 30)), // Last 30 days instead of just yesterday
				},
				relations: ['owner', 'branch', 'organisation'],
				order: { createdAt: 'DESC' },
				take: 200, // Increased from 100
			});

			this.logger.log(`Found ${journals.length} journal entries from last 30 days`);

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
			this.logger.debug('Fetching check-in data (Note: CheckIn entity has limited location data)');
			const checkIns = await this.checkInRepository.find({
				where: {
					organisation: { uid: organisationId }, // Correct relation name
					...(branchId ? { branch: { uid: branchId } } : {}),
					// Note: CheckIn entity doesn't have createdAt field, so we remove date filter for now
				},
				relations: ['owner', 'client', 'branch', 'organisation'],
				// Note: CheckIn entity doesn't have createdAt field, so we can't order by it
				take: 200,
			});

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
			this.logger.debug('Fetching comprehensive task data with expanded date range');
			const tasks = await this.taskRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					// Expand date range to get more tasks
					updatedAt: MoreThanOrEqual(subDays(new Date(), 30)), // Last 30 days instead of just yesterday
				},
				relations: ['creator', 'branch', 'organisation'], // Task has creator not createdBy, no direct client/assignedTo relations
				order: { updatedAt: 'DESC' },
				take: 200, // Increased from 100
			});

			this.logger.log(`Found ${tasks.length} tasks updated in last 30 days`);

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

			// ---------- QUOTATIONS (Enhanced to include more records) ----------
			this.logger.debug('Fetching quotations data with expanded date range');
			
			// First, get total quotation count for debugging
			const totalQuotationCountAll = await this.quotationRepository.count({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
				}
			});
			this.logger.log(`📊 Total quotations in DB for org ${organisationId}: ${totalQuotationCountAll}`);
			
			const quotationsRaw = await this.quotationRepository.find({
				where: {
					organisation: { uid: organisationId }, // Use correct relation
					...(branchId ? { branch: { uid: branchId } } : {}), // Use correct relation
					// Expand date range to get ALL quotations for now to debug the issue
					// createdAt: MoreThanOrEqual(subDays(new Date(), 90)), // Remove date restriction temporarily
				},
				relations: ['client', 'branch', 'organisation'],
				select: ['uid', 'totalAmount', 'status', 'quotationNumber', 'createdAt'],
				take: 1000, // Limit to avoid performance issues but get more data
			});

			this.logger.log(`Found ${quotationsRaw.length} quotations total for organization ${organisationId}`);
			
			// Filter quotations by client location availability and log detailed info
			const quotationsWithClients = quotationsRaw.filter(q => q.client);
			const quotationsWithoutClients = quotationsRaw.filter(q => !q.client);
			
			this.logger.log(`Quotations breakdown: ${quotationsWithClients.length} with clients, ${quotationsWithoutClients.length} without clients`);
			
			const quotationsWithLocation = quotationsWithClients.filter(q => q.client?.latitude && q.client?.longitude);
			const quotationsWithoutLocation = quotationsWithClients.filter(q => !q.client?.latitude || !q.client?.longitude);
			
			this.logger.log(`Quotations with clients: ${quotationsWithLocation.length} with location data, ${quotationsWithoutLocation.length} without location data`);
			
			const quotations = quotationsWithLocation.map((q) => {
					this.logger.debug(`Mapping quotation data for ${q.quotationNumber || q.uid} - client: ${q.client.name}`);
					return {
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
						placedBy: 'System', // Default value
						isConverted: false, // Default value
					};
				});

			allMarkers.push(...quotations);
				
			this.logger.log(`Processed ${quotations.length} quotations with valid client locations`);

			// ---------- EVENTS (Recent activities) ----------
			this.logger.debug('Generating events data from recent activities');
			const events = await this.generateRecentEvents({
				organisationId,
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

			// Performance logging
			const endTime = new Date();
			const executionTime = endTime.getTime() - startTime.getTime();

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
			};
			
			// Debug: Log the filtered marker counts
			this.logger.log(`📊 Filtered marker counts - Workers: ${markersByType.workers.length}, Clients: ${markersByType.clients.length}, Competitors: ${markersByType.competitors.length}, Quotations: ${markersByType.quotations.length}, Leads: ${markersByType.leads.length}, Journals: ${markersByType.journals.length}, Tasks: ${markersByType.tasks.length}, Check-ins: ${markersByType.checkIns.length}`);
			
			// Verify that competitors and quotations are in allMarkers
			const competitorsInAll = allMarkers.filter(m => m.markerType === 'competitor');
			const quotationsInAll = allMarkers.filter(m => m.markerType === 'quotation');
			this.logger.log(`📊 Debug verification - Competitors in allMarkers: ${competitorsInAll.length}, Quotations in allMarkers: ${quotationsInAll.length}`);
			
			const finalData = {
				// Individual arrays for backward compatibility
				workers: markersByType.workers,
				clients: markersByType.clients,
				competitors: markersByType.competitors,
				quotations: markersByType.quotations,
				
				// New comprehensive data arrays
				leads: markersByType.leads,
				journals: markersByType.journals,
				tasks: markersByType.tasks,
				checkIns: markersByType.checkIns,
				shiftStarts: markersByType.shiftStarts,
				shiftEnds: markersByType.shiftEnds,
				breakStarts: markersByType.breakStarts,
				breakEnds: markersByType.breakEnds,
				
				// All markers combined for comprehensive filtering
				allMarkers: allMarkers,
				
				// Events data
				events,
				
				// Map configuration
				mapConfig: {
					defaultCenter,
					orgRegions,
				},
			};
			
			this.logger.log(`Map data generation completed successfully in ${executionTime}ms`);
			this.logger.log(`Summary - Total markers: ${allMarkers.length}, Workers: ${markersByType.workers.length}, Clients: ${markersByType.clients.length}, Competitors: ${markersByType.competitors.length}, Quotations: ${markersByType.quotations.length}, Leads: ${markersByType.leads.length}, Journals: ${markersByType.journals.length}, Tasks: ${markersByType.tasks.length}, Check-ins: ${markersByType.checkIns.length}, Events: ${events.length}`);
			
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
		branchId?: number;
		todayStart: Date;
		yesterdayStart: Date;
	}): Promise<any[]> {
		const { organisationId, branchId, todayStart, yesterdayStart } = params;
		const events: any[] = [];

		try {
			this.logger.debug('Fetching recent check-ins for events');
			// Recent check-ins - Note: CheckIn entity has limited fields, using client location
			const recentCheckIns = await this.checkInRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					// Note: CheckIn doesn't have createdAt field, so we remove date filter
				},
				relations: ['owner', 'client'],
				take: 10,
				// Note: CheckIn doesn't have createdAt field, so we can't order by it
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
										? `Assignee (ID: ${task.assignees[0].uid})`
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
			// Recent leads - Note: Lead uses different field names
			const recentLeads = await this.leadRepository.find({
				where: {
					organisationUid: organisationId, // Lead uses organisationUid not organisation relation
					...(branchId ? { branchUid: branchId } : {}), // Lead uses branchUid not branch relation
					createdAt: MoreThanOrEqual(yesterdayStart),
					isDeleted: false,
				},
				relations: ['owner'], // Lead has owner, not createdBy
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

