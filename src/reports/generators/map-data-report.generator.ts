import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, IsNull, In, Not } from 'typeorm';
import { startOfDay } from 'date-fns';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { Client } from '../../clients/entities/client.entity';
import { Competitor } from '../../competitors/entities/competitor.entity';
import { Quotation } from '../../shop/entities/quotation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { GeneralStatus } from '../../lib/enums/status.enums';

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
	) {}

	async generate(params: MapDataRequestParams): Promise<Record<string, any>> {
		try {
			const { organisationId, branchId, userId } = params;
			
			// Input validation
			if (!organisationId || organisationId <= 0) {
				throw new Error('Invalid organisation ID provided');
			}
			
			if (branchId && branchId <= 0) {
				throw new Error('Invalid branch ID provided');
			}

			// Verify organization exists and user has access
			const organisation = await this.organisationRepository.findOne({ 
				where: { uid: organisationId },
				select: ['uid', 'name', 'status']
			});
			
			if (!organisation) {
				throw new Error('Organisation not found or access denied');
			}

			if (organisation.status !== GeneralStatus.ACTIVE) {
				throw new Error('Organisation is not active');
			}

			// If branchId is provided, verify it belongs to the organization
			if (branchId) {
				const branch = await this.branchRepository.findOne({
					where: { 
						uid: branchId, 
						organisation: { uid: organisationId } 
					},
					select: ['uid', 'name']
				});
				
				if (!branch) {
					throw new Error('Branch not found or does not belong to the specified organisation');
				}
			}

			const todayStart = startOfDay(new Date());

			// ---------- WORKERS (Employees currently checked-in) ----------
			const activeAttendance = await this.attendanceRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
					checkIn: MoreThanOrEqual(todayStart),
					checkOut: IsNull(),
				},
				relations: ['owner'],
			});

			const workers = activeAttendance
				.filter((a) => a.checkInLatitude && a.checkInLongitude)
				.map((a) => ({
					id: a.owner?.uid,
					name: a.owner?.name,
					position: [Number(a.checkInLatitude), Number(a.checkInLongitude)] as [number, number],
					latitude: Number(a.checkInLatitude),
					longitude: Number(a.checkInLongitude),
					markerType: 'check-in',
					status: a.status,
					checkInTime: a.checkIn?.toISOString(),
				}));

			// ---------- CLIENTS (Enhanced with comprehensive data) ----------
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
					'socialProfiles', 'customFields', 'geofenceType', 'geofenceRadius',
					'enableGeofence', 'createdAt', 'updatedAt'
				],
			});

			const clientMarkers = clients.map((c) => ({
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
				socialProfiles: c.socialProfiles,
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
			}));

			// ---------- COMPETITORS (Enhanced with comprehensive data) ----------
			const competitors = await this.competitorRepository.find({
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
			});

			const competitorMarkers = competitors.map((c) => ({
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
			}));

			// ---------- QUOTATIONS (recent) ----------
			const quotationsRaw = await this.quotationRepository.find({
				where: {
					organisation: { uid: organisationId },
					...(branchId ? { branch: { uid: branchId } } : {}),
					createdAt: MoreThanOrEqual(todayStart),
				},
				relations: ['client', 'branch'],
				select: ['uid', 'totalAmount', 'status', 'client', 'quotationNumber', 'createdAt'],
			});
			const quotations = quotationsRaw
				.filter((q) => q.client?.latitude && q.client?.longitude)
				.map((q) => ({
					id: q.uid,
					quotationNumber: (q as any).quotationNumber,
					clientName: q.client.name,
					position: [Number(q.client.latitude), Number(q.client.longitude)] as [number, number],
					latitude: Number(q.client.latitude),
					longitude: Number(q.client.longitude),
					totalAmount: q.totalAmount,
					status: q.status,
					quotationDate: q.createdAt,
					validUntil: (q as any).expiryDate,
					markerType: 'quotation',
				}));

			// ---------- Map Config ----------
			let defaultCenter = { lat: 0, lng: 0 };
			
			// Set default center based on available data
			if (workers.length > 0) {
				defaultCenter = { lat: workers[0].latitude, lng: workers[0].longitude };
			} else if (clientMarkers.length > 0) {
				defaultCenter = { lat: clientMarkers[0].latitude, lng: clientMarkers[0].longitude };
			} else if (competitorMarkers.length > 0) {
				defaultCenter = { lat: competitorMarkers[0].latitude, lng: competitorMarkers[0].longitude };
			} else {
				// Default to South Africa coordinates if no data available
				defaultCenter = { lat: -26.2041, lng: 28.0473 }; // Johannesburg, South Africa
			}

			const branches = await this.branchRepository.find({
				where: { 
					organisation: { uid: organisationId },
					...(branchId ? { uid: branchId } : {})
				},
				select: ['uid', 'name', 'address'],
			});

			const orgRegions: Array<{ name: string; center: { lat: number; lng: number }; zoom: number }> = [];

			return {
				workers,
				clients: clientMarkers,
				competitors: competitorMarkers,
				quotations,
				mapConfig: {
					defaultCenter,
					orgRegions,
				},
			};
		} catch (error) {
			// Log the error with context
			this.logger.error(
				`Error generating map data for organisation ${params.organisationId}${params.branchId ? ` and branch ${params.branchId}` : ''}: ${error.message}`, 
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
}

