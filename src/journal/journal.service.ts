import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Journal } from './entities/journal.entity';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { NotificationType, NotificationStatus } from '../lib/enums/notification.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { JournalStatus, JournalType, InspectionRating, InspectionFormData, InspectionCategory, InspectionItem } from '../lib/enums/journal.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { endOfDay, startOfDay } from 'date-fns';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES, XP_VALUES_TYPES } from '../lib/constants/constants';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';

@Injectable()
export class JournalService {
	private readonly logger = new Logger(JournalService.name);

	constructor(
		@InjectRepository(Journal)
		private journalRepository: Repository<Journal>,
		private readonly eventEmitter: EventEmitter2,
		private readonly rewardsService: RewardsService,
	) {}

	private calculateStats(journals: Journal[]): {
		total: number;
	} {
		return {
			total: journals?.length || 0,
		};
	}

	async create(createJournalDto: CreateJournalDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		this.logger.log(`Creating journal for orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Create journal DTO: ${JSON.stringify(createJournalDto)}`);

		try {
			// Add organization and branch information
			const journalData = {
				...createJournalDto,
				organisation: orgId ? { uid: orgId } : undefined,
				branch: branchId ? { uid: branchId } : undefined,
			};

			this.logger.debug(`Journal data to save: ${JSON.stringify(journalData)}`);

			const journal = await this.journalRepository.save(journalData);

			if (!journal) {
				this.logger.error('Failed to save journal - repository returned null');
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.log(`Journal created successfully with ID: ${journal.uid}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			const notification = {
				type: NotificationType.USER,
				title: 'Journal Created',
				message: `A journal has been created`,
				status: NotificationStatus.UNREAD,
				owner: journal?.owner,
			};

			const recipients = [
				AccessLevel.ADMIN,
				AccessLevel.MANAGER,
				AccessLevel.OWNER,
				AccessLevel.SUPERVISOR,
				AccessLevel.USER,
			];

			this.eventEmitter.emit('send.notification', notification, recipients);

			try {
				await this.rewardsService.awardXP({
					owner: createJournalDto.owner.uid,
					amount: 10,
					action: 'JOURNAL',
					source: {
						id: createJournalDto.owner.uid.toString(),
						type: 'journal',
						details: 'Journal reward',
					},
				}, orgId, branchId);
				this.logger.log(`XP awarded for journal creation: ${createJournalDto.owner.uid}`);
			} catch (xpError) {
				this.logger.warn(`Failed to award XP for journal creation: ${xpError.message}`);
			}

			return response;
		} catch (error) {
			this.logger.error(`Error creating journal: ${error.message}`, error.stack);
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async findAll(
		filters?: {
			status?: JournalStatus;
			authorId?: number;
			startDate?: Date;
			endDate?: Date;
			search?: string;
			categoryId?: number;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Journal>> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.branch', 'branch')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.where('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			if (filters?.status) {
				queryBuilder.andWhere('journal.status = :status', { status: filters.status });
			}

			if (filters?.authorId) {
				queryBuilder.andWhere('owner.uid = :authorId', { authorId: filters.authorId });
			}

			if (filters?.startDate && filters?.endDate) {
				queryBuilder.andWhere('journal.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
			}

			if (filters?.search) {
				queryBuilder.andWhere(
					'(journal.clientRef ILIKE :search OR journal.comments ILIKE :search OR owner.name ILIKE :search)',
					{ search: `%${filters.search}%` },
				);
			}

			// Add pagination
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('journal.createdAt', 'DESC');

			const [journals, total] = await queryBuilder.getManyAndCount();

			if (!journals) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			return {
				data: journals,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	async findOne(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; journal: Journal | null; stats: any }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.uid = :ref', { ref })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journal = await queryBuilder.getOne();

			if (!journal) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
					journal: null,
					stats: null,
				};
			}

			// Get stats with organization/branch filtering
			const statsQueryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch');

			if (orgId) {
				statsQueryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			if (branchId) {
				statsQueryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const allJournals = await statsQueryBuilder.getMany();
			const stats = this.calculateStats(allJournals);

			return {
				journal,
				message: process.env.SUCCESS_MESSAGE,
				stats,
			};
		} catch (error) {
			return {
				message: error?.message,
				journal: null,
				stats: null,
			};
		}
	}

	public async journalsByUser(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; journals: Journal[]; stats: { total: number } }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('owner.uid = :ref', { ref })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journals = await queryBuilder.getMany();

			if (!journals) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const stats = this.calculateStats(journals);

			return {
				message: process.env.SUCCESS_MESSAGE,
				journals,
				stats,
			};
		} catch (error) {
			return {
				message: `could not get journals by user - ${error?.message}`,
				journals: null,
				stats: null,
			};
		}
	}

	async getJournalsForDate(
		date: Date,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; journals: Journal[] }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.createdAt BETWEEN :startOfDay AND :endOfDay', {
					startOfDay: startOfDay(date),
					endOfDay: endOfDay(date),
				});

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journals = await queryBuilder.getMany();

			if (!journals) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				journals,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				journals: null,
			};

			return response;
		}
	}

	async update(ref: number, updateJournalDto: UpdateJournalDto, orgId?: number, branchId?: number) {
		this.logger.log(`Updating journal ${ref} for orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Update journal DTO: ${JSON.stringify(updateJournalDto)}`);

		try {
			// First verify the journal belongs to the org/branch
			const journalResult = await this.findOne(ref, orgId, branchId);

			if (!journalResult || !journalResult.journal) {
				this.logger.warn(`Journal ${ref} not found for orgId: ${orgId}, branchId: ${branchId}`);
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const journal = journalResult.journal;
			this.logger.debug(`Found journal to update: ${JSON.stringify(journal)}`);

			const updateResult = await this.journalRepository.update(ref, updateJournalDto);
			this.logger.debug(`Update result: ${JSON.stringify(updateResult)}`);

			if (updateResult.affected === 0) {
				this.logger.warn(`No rows affected when updating journal ${ref}`);
			} else {
				this.logger.log(`Successfully updated journal ${ref}, affected rows: ${updateResult.affected}`);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			const notification = {
				type: NotificationType.USER,
				title: 'Journal Updated',
				message: `A journal has been updated`,
				status: NotificationStatus.UNREAD,
				owner: journal?.owner,
			};

			const recipients = [
				AccessLevel.ADMIN,
				AccessLevel.MANAGER,
				AccessLevel.OWNER,
				AccessLevel.SUPERVISOR,
				AccessLevel.USER,
			];

			this.eventEmitter.emit('send.notification', notification, recipients);

			try {
				// Use the owner from the existing journal since update might not include owner
				const ownerUid = updateJournalDto.owner?.uid || journal.owner.uid;
				await this.rewardsService.awardXP({
					owner: ownerUid,
					amount: XP_VALUES.JOURNAL,
					action: XP_VALUES_TYPES.JOURNAL,
					source: {
						id: ownerUid.toString(),
						type: XP_VALUES_TYPES.JOURNAL,
						details: 'Journal reward',
					},
				}, orgId, branchId);
				this.logger.log(`XP awarded for journal update: ${ownerUid}`);
			} catch (xpError) {
				this.logger.warn(`Failed to award XP for journal update: ${xpError.message}`);
			}

			return response;
		} catch (error) {
			this.logger.error(`Error updating journal ${ref}: ${error.message}`, error.stack);
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			// First verify the journal belongs to the org/branch
			const journalResult = await this.findOne(ref, orgId, branchId);

			if (!journalResult || !journalResult.journal) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			await this.journalRepository.update(ref, { isDeleted: true });

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async restore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			// Find the deleted journal specifically
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.uid = :ref', { ref })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: true });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journal = await queryBuilder.getOne();

			if (!journal) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			await this.journalRepository.update(ref, { isDeleted: false });

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async count(orgId?: number, branchId?: number): Promise<{ total: number }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch');

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const total = await queryBuilder.getCount();

			return {
				total,
			};
		} catch (error) {
			return {
				total: 0,
			};
		}
	}

	async getJournalsReport(filter: any, orgId?: number, branchId?: number) {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.branch', 'branch')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.where('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Add filter conditions from the filter object
			if (filter) {
				Object.keys(filter).forEach((key) => {
					if (filter[key] !== undefined && filter[key] !== null) {
						queryBuilder.andWhere(`journal.${key} = :${key}`, { [key]: filter[key] });
					}
				});
			}

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('journal.timestamp', 'DESC');

			const journals = await queryBuilder.getMany();

			if (!journals) {
				throw new NotFoundException('No journals found for the specified period');
			}

			const totalEntries = journals.length;
			const categories = this.analyzeJournalCategories(journals);
			const entriesPerDay = this.calculateEntriesPerDay(journals);
			const completionRate = this.calculateCompletionRate(journals);

			return {
				entries: journals,
				metrics: {
					totalEntries,
					averageEntriesPerDay: entriesPerDay,
					topCategories: categories,
					completionRate: `${completionRate}%`,
				},
			};
		} catch (error) {
			return null;
		}
	}

	private analyzeJournalCategories(journals: Journal[]): Array<{ category: string; count: number }> {
		const categoryCounts = journals.reduce((acc, journal) => {
			// Extract category from comments or clientRef if available
			const category = this.extractCategory(journal);
			acc[category] = (acc[category] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		return Object.entries(categoryCounts)
			.map(([category, count]) => ({ category, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5); // Return top 5 categories
	}

	private extractCategory(journal: Journal): string {
		// Try to extract category from comments
		const comments = journal.comments.toLowerCase();
		if (comments.includes('meeting')) return 'Meeting';
		if (comments.includes('call')) return 'Call';
		if (comments.includes('report')) return 'Report';
		if (comments.includes('follow')) return 'Follow-up';
		return 'Other';
	}

	private calculateEntriesPerDay(journals: Journal[]): number {
		if (journals.length === 0) return 0;

		const dates = journals.map((j) => j.timestamp.toISOString().split('T')[0]);
		const uniqueDates = new Set(dates).size;
		return Number((journals.length / uniqueDates).toFixed(1));
	}

	private calculateCompletionRate(journals: Journal[]): number {
		if (journals.length === 0) return 0;

		const completedEntries = journals.filter(
			(journal) => journal.fileURL && journal.comments && journal.comments.length > 10,
		).length;

		return Number(((completedEntries / journals.length) * 100).toFixed(1));
	}

	// ======================================================
	// INSPECTION-SPECIFIC FUNCTIONALITY
	// ======================================================

	async createInspection(createJournalDto: CreateJournalDto, orgId?: number, branchId?: number): Promise<{ message: string; data?: any }> {
		this.logger.log(`Creating inspection journal for orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Create inspection DTO: ${JSON.stringify(createJournalDto)}`);

		try {
			// Set type to INSPECTION
			const inspectionData = {
				...createJournalDto,
				type: JournalType.INSPECTION,
				organisation: orgId ? { uid: orgId } : undefined,
				branch: branchId ? { uid: branchId } : undefined,
			};

			// Calculate scores if inspection data is provided
			if (inspectionData.inspectionData) {
				const scoreCalculation = this.calculateInspectionScore(inspectionData.inspectionData);
				inspectionData.totalScore = scoreCalculation.totalScore;
				inspectionData.maxScore = scoreCalculation.maxScore;
				inspectionData.percentage = scoreCalculation.percentage;
				inspectionData.overallRating = scoreCalculation.overallRating;
			}

			this.logger.debug(`Inspection data to save: ${JSON.stringify(inspectionData)}`);

			const journal = await this.journalRepository.save(inspectionData);

			if (!journal) {
				this.logger.error('Failed to save inspection journal - repository returned null');
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.log(`Inspection journal created successfully with ID: ${journal.uid}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				data: {
					uid: journal.uid,
					totalScore: journal.totalScore,
					percentage: journal.percentage,
					overallRating: journal.overallRating
				}
			};

			// Send notification
			const notification = {
				type: NotificationType.USER,
				title: 'Inspection Completed',
				message: `An inspection has been completed with ${journal.percentage?.toFixed(1)}% score`,
				status: NotificationStatus.UNREAD,
				owner: journal?.owner,
			};

			const recipients = [
				AccessLevel.ADMIN,
				AccessLevel.MANAGER,
				AccessLevel.OWNER,
				AccessLevel.SUPERVISOR,
			];

			this.eventEmitter.emit('send.notification', notification, recipients);

			// Award XP based on inspection score
			try {
				const xpAmount = this.calculateInspectionXP(journal.percentage || 0);
				await this.rewardsService.awardXP({
					owner: createJournalDto.owner.uid,
					amount: xpAmount,
					action: 'INSPECTION',
					source: {
						id: createJournalDto.owner.uid.toString(),
						type: 'inspection',
						details: `Inspection completed with ${journal.percentage?.toFixed(1)}% score`,
					},
				}, orgId, branchId);
				this.logger.log(`XP awarded for inspection: ${createJournalDto.owner.uid} - ${xpAmount}XP`);
			} catch (xpError) {
				this.logger.warn(`Failed to award XP for inspection: ${xpError.message}`);
			}

			return response;
		} catch (error) {
			this.logger.error(`Error creating inspection journal: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	async getAllInspections(orgId?: number, branchId?: number): Promise<{ message: string; data: Journal[] }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.branch', 'branch')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.where('journal.type = :type', { type: JournalType.INSPECTION })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('journal.createdAt', 'DESC');

			const inspections = await queryBuilder.getMany();

			if (!inspections) {
				throw new NotFoundException('No inspections found');
			}

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: inspections,
			};
		} catch (error) {
			return {
				message: error?.message,
				data: [],
			};
		}
	}

	async getInspectionDetail(ref: number, orgId?: number, branchId?: number): Promise<{ message: string; data: Journal | null }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.uid = :ref', { ref })
				.andWhere('journal.type = :type', { type: JournalType.INSPECTION })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const inspection = await queryBuilder.getOne();

			if (!inspection) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
					data: null,
				};
			}

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: inspection,
			};
		} catch (error) {
			return {
				message: error?.message,
				data: null,
			};
		}
	}

	async getInspectionTemplates(orgId?: number, branchId?: number): Promise<{ message: string; data: any[] }> {
		try {
			// Return predefined inspection templates based on the images
			const templates = [
				{
					id: 'store_comprehensive',
					name: 'Comprehensive Store Inspection',
					description: 'Complete store inspection covering all operational areas',
					categories: [
						{
							id: 'fresh_produce',
							name: 'Fresh Produce, Meat & Bakery',
							weight: 20,
							items: [
								{ id: 'fruits_vegetables', name: 'Fruits & vegetables freshness', required: true },
								{ id: 'meat_hygiene', name: 'Meat & fish hygiene standards', required: true },
								{ id: 'bakery_freshness', name: 'Bakery freshness & labeling', required: true },
								{ id: 'temp_compliance', name: 'Refrigerated product temp compliance', required: true },
								{ id: 'storage_rotation', name: 'Storage/rotation practices', required: true }
							]
						},
						{
							id: 'cold_storage',
							name: 'Cold Storage & Freezers',
							weight: 15,
							items: [
								{ id: 'temperature_control', name: 'Temperature control', required: true },
								{ id: 'temp_logs', name: 'Temperature logs maintained', required: true },
								{ id: 'freezer_cleanliness', name: 'Freezers clean, no ice/leakage', required: true },
								{ id: 'items_sealed', name: 'Items sealed & labeled', required: true }
							]
						},
						{
							id: 'health_safety',
							name: 'Health & Safety',
							weight: 25,
							items: [
								{ id: 'fire_extinguishers', name: 'Fire extinguishers serviced & accessible', required: true },
								{ id: 'emergency_exits', name: 'Emergency exits clear & marked', required: true },
								{ id: 'first_aid', name: 'First aid kit stocked', required: true },
								{ id: 'electrical_safety', name: 'Electrical & structural safety', required: true },
								{ id: 'pest_control', name: 'Pest control records', required: true }
							]
						},
						{
							id: 'customer_service',
							name: 'Customer Service',
							weight: 15,
							items: [
								{ id: 'staff_availability', name: 'Staff availability & presence', required: true },
								{ id: 'staff_attitude', name: 'Staff attitude & training', required: true },
								{ id: 'queue_management', name: 'Queue management', required: true },
								{ id: 'feedback_handling', name: 'Feedback/complaints handling', required: false },
								{ id: 'pa_system', name: 'PA system functionality', required: false }
							]
						},
						{
							id: 'cashier_checkout',
							name: 'Cashier & Checkout Area',
							weight: 15,
							items: [
								{ id: 'pos_system', name: 'POS system functionality', required: true },
								{ id: 'transaction_efficiency', name: 'Transaction efficiency', required: true },
								{ id: 'queue_barriers', name: 'Queue barriers & order', required: true },
								{ id: 'bag_availability', name: 'Bag availability', required: true },
								{ id: 'till_cleanliness', name: 'Till area cleanliness', required: true }
							]
						},
						{
							id: 'warehouse',
							name: 'Back of House (Warehouse/Storage)',
							weight: 10,
							items: [
								{ id: 'stock_organization', name: 'Stock organization & labeling', required: true },
								{ id: 'temp_sensitive_storage', name: 'Temperature-sensitive storage', required: true },
								{ id: 'security_measures', name: 'Security measures', required: true }
							]
						},
						{
							id: 'compliance',
							name: 'Compliance & Documentation',
							weight: 20,
							items: [
								{ id: 'business_licenses', name: 'Business licenses & certificates', required: true },
								{ id: 'staff_training', name: 'Staff hygiene training records', required: true },
								{ id: 'cleaning_logs', name: 'Cleaning/temperature logs', required: true },
								{ id: 'promo_approvals', name: 'Promo & discount approvals', required: false }
							]
						}
					]
				}
			];

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: templates,
			};
		} catch (error) {
			return {
				message: error?.message,
				data: [],
			};
		}
	}

	async recalculateScore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string; data?: any }> {
		try {
			const inspectionResult = await this.getInspectionDetail(ref, orgId, branchId);
			
			if (!inspectionResult.data) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const inspection = inspectionResult.data;

			if (!inspection.inspectionData) {
				throw new BadRequestException('No inspection data found to recalculate');
			}

			// Recalculate scores
			const scoreCalculation = this.calculateInspectionScore(inspection.inspectionData);

			// Update the inspection record
			await this.journalRepository.update(ref, {
				totalScore: scoreCalculation.totalScore,
				maxScore: scoreCalculation.maxScore,
				percentage: scoreCalculation.percentage,
				overallRating: scoreCalculation.overallRating
			});

			this.logger.log(`Recalculated scores for inspection ${ref}: ${scoreCalculation.percentage}%`);

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: {
					totalScore: scoreCalculation.totalScore,
					maxScore: scoreCalculation.maxScore,
					percentage: scoreCalculation.percentage,
					overallRating: scoreCalculation.overallRating
				}
			};
		} catch (error) {
			this.logger.error(`Error recalculating scores for inspection ${ref}: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	// ======================================================
	// INSPECTION HELPER METHODS
	// ======================================================

	private calculateInspectionScore(inspectionData: InspectionFormData): {
		totalScore: number;
		maxScore: number;
		percentage: number;
		overallRating: InspectionRating;
	} {
		let totalScore = 0;
		let maxScore = 0;
		let weightedScore = 0;
		let totalWeight = 0;

		// Calculate scores for each category
		for (const category of inspectionData.categories) {
			let categoryScore = 0;
			let categoryMaxScore = 0;

			for (const item of category.items) {
				if (item.score !== undefined) {
					categoryScore += item.score;
				}
				categoryMaxScore += 5; // Assuming 1-5 scale
			}

			// Apply category weight if provided
			const weight = category.weight || 1;
			weightedScore += (categoryScore / categoryMaxScore) * weight;
			totalWeight += weight;

			totalScore += categoryScore;
			maxScore += categoryMaxScore;
		}

		// Calculate final percentage (prefer weighted if weights are provided)
		const percentage = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : (totalScore / maxScore) * 100;

		// Determine overall rating
		let overallRating: InspectionRating;
		if (percentage >= 95) {
			overallRating = InspectionRating.EXCELLENT;
		} else if (percentage >= 85) {
			overallRating = InspectionRating.GOOD;
		} else if (percentage >= 70) {
			overallRating = InspectionRating.AVERAGE;
		} else if (percentage >= 50) {
			overallRating = InspectionRating.POOR;
		} else {
			overallRating = InspectionRating.CRITICAL;
		}

		return {
			totalScore,
			maxScore,
			percentage: Number(percentage.toFixed(2)),
			overallRating
		};
	}

	private calculateInspectionXP(percentage: number): number {
		// Award XP based on inspection performance
		if (percentage >= 95) return 50; // Excellent
		if (percentage >= 85) return 30; // Good
		if (percentage >= 70) return 20; // Average
		if (percentage >= 50) return 10; // Poor
		return 5; // Critical (participation award)
	}
}
