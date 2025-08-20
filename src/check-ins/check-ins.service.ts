import { BadRequestException, Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { Repository } from 'typeorm';
import { CheckIn } from './entities/check-in.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateCheckOutDto } from './dto/create-check-out.dto';
import { differenceInMinutes, differenceInHours } from 'date-fns';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { User } from 'src/user/entities/user.entity';
import { Client } from 'src/clients/entities/client.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

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
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default

		this.logger.log('CheckInsService initialized with cache TTL: ' + this.CACHE_TTL + 'ms');
		this.logger.debug(`CheckInsService initialized with dependencies:`);
		this.logger.debug(`CheckIn Repository: ${!!this.checkInRepository}`);
		this.logger.debug(`User Repository: ${!!this.userRepository}`);
		this.logger.debug(`Client Repository: ${!!this.clientRepository}`);
		this.logger.debug(`Rewards Service: ${!!this.rewardsService}`);
		this.logger.debug(`Cache Manager: ${!!this.cacheManager}`);
	}

	async checkIn(createCheckInDto: CreateCheckInDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		this.logger.log(`Check-in attempt for user: ${createCheckInDto.owner?.uid}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			// Enhanced validation
			this.logger.debug('Validating check-in data');
			if (!createCheckInDto?.owner?.uid) {
				this.logger.error('User ID is required for check-in');
				throw new BadRequestException('User ID is required for check-in');
			}

			if (!orgId) {
				this.logger.error('Organization ID is required for check-in');
				throw new BadRequestException('Organization ID is required');
			}

			// Validate user belongs to the organization
			this.logger.debug(`Validating user ${createCheckInDto.owner.uid} belongs to organization ${orgId}`);
			const user = await this.userRepository.findOne({
				where: { uid: createCheckInDto.owner.uid },
				relations: ['organisation']
			});

			if (!user) {
				this.logger.error(`User not found with ID: ${createCheckInDto.owner.uid}`);
				throw new NotFoundException('User not found');
			}

			if (user.organisation?.uid !== orgId) {
				this.logger.error(`User ${createCheckInDto.owner.uid} belongs to org ${user.organisation?.uid}, not ${orgId}`);
				throw new BadRequestException('User does not belong to the specified organization');
			}

			this.logger.debug(`User validated: ${user.email} (${user.name}) in organization: ${orgId}`);

			// Validate branch information
			if (!createCheckInDto?.branch?.uid) {
				this.logger.error('Branch information is required for check-in');
				throw new BadRequestException('Branch information is required');
			}

			// Enhanced data mapping with proper organization filtering
			this.logger.debug('Creating check-in record with enhanced data mapping');
			const checkInData = {
				...createCheckInDto,
				organization: {
					uid: orgId, // Use the validated orgId instead of user's org
				},
				branch: {
					uid: branchId || createCheckInDto.branch.uid,
				},
			};

			const checkIn = await this.checkInRepository.save(checkInData);

			if (!checkIn) {
				this.logger.error('Failed to create check-in record - database returned null');
				throw new BadRequestException('Failed to create check-in record');
			}

			this.logger.debug(`Check-in record created successfully with ID: ${checkIn.uid}`);

			// Update client GPS coordinates if client is provided
			if (createCheckInDto.client && createCheckInDto.client.uid) {
				this.logger.debug(`Updating client ${createCheckInDto.client.uid} GPS coordinates`);
				try {
					await this.clientRepository.update(
						{ uid: createCheckInDto.client.uid },
						{ gpsCoordinates: createCheckInDto.checkInLocation }
					);
					this.logger.debug(`Client GPS coordinates updated successfully`);
				} catch (clientError) {
					this.logger.error(`Failed to update client GPS coordinates: ${clientError.message}`);
					// Don't fail the check-in if client update fails
				}
			}

			// Enhanced response mapping
			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Check-in recorded successfully',
			};

			// Award XP with enhanced error handling
			try {
				this.logger.debug(`Awarding XP for check-in to user: ${createCheckInDto.owner.uid}`);
				await this.rewardsService.awardXP({
					owner: createCheckInDto.owner.uid,
					amount: XP_VALUES.CHECK_IN_CLIENT,
					action: XP_VALUES_TYPES.CHECK_IN_CLIENT,
					source: {
						id: String(createCheckInDto.owner.uid),
						type: XP_VALUES_TYPES.CHECK_IN_CLIENT,
						details: 'Check-in reward',
					},
				}, orgId, branchId);
				this.logger.debug(`XP awarded successfully for check-in to user: ${createCheckInDto.owner.uid}`);
			} catch (xpError) {
				this.logger.error(`Failed to award XP for check-in to user: ${createCheckInDto.owner.uid}`, xpError.stack);
				// Don't fail the check-in if XP award fails
			}

			this.logger.log(`Check-in successful for user: ${createCheckInDto.owner.uid}`);

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async checkOut(createCheckOutDto: CreateCheckOutDto, orgId?: number, branchId?: number): Promise<{ message: string; duration?: string }> {
		try {
			if (!createCheckOutDto?.owner) {
				throw new BadRequestException(process.env.NOT_FOUND_MESSAGE);
			}

			if (!createCheckOutDto?.branch) {
				throw new BadRequestException(process.env.NOT_FOUND_MESSAGE);
			}

			const checkIn = await this.checkInRepository.findOne({
				where: {
					owner: {
						uid: createCheckOutDto.owner.uid,
					},
				},
				order: {
					checkInTime: 'DESC',
				},
			});

			if (!checkIn) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const checkOutTime = new Date(createCheckOutDto.checkOutTime);
			const checkInTime = new Date(checkIn.checkInTime);

			const minutesWorked = differenceInMinutes(checkOutTime, checkInTime);
			const hoursWorked = differenceInHours(checkOutTime, checkInTime);
			const remainingMinutes = minutesWorked % 60;

			const duration = `${hoursWorked}h ${remainingMinutes}m`;

			await this.checkInRepository.update(checkIn.uid, {
				checkOutTime: createCheckOutDto?.checkOutTime,
				checkOutPhoto: createCheckOutDto?.checkOutPhoto,
				checkOutLocation: createCheckOutDto?.checkOutLocation,
				duration: duration,
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			await this.rewardsService.awardXP({
				owner: createCheckOutDto.owner.uid,
				amount: 10,
				action: 'CHECK_OUT',
				source: {
					id: createCheckOutDto.owner.toString(),
					type: 'check-in',
					details: 'Check-out reward',
				},
			}, orgId, branchId);

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async checkInStatus(reference: number): Promise<any> {
		try {
			const [checkIn] = await this.checkInRepository.find({
				where: {
					owner: {
						uid: reference,
					},
				},
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client'],
			});

			if (!checkIn) {
				throw new NotFoundException('Check-in not found');
			}

			const nextAction =
				checkIn.checkInTime && checkIn.checkInLocation && !checkIn.checkOutTime ? 'checkOut' : 'checkIn';

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				nextAction,
				checkedIn: nextAction === 'checkOut',
				...checkIn,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				nextAction: 'Check In',
				checkedIn: false,
			};

			return response;
		}
	}

	async getAllCheckIns(organizationUid?: string): Promise<any> {
		try {
			const whereCondition: any = {};
			
			if (organizationUid) {
				whereCondition.organization = { uid: organizationUid };
			}

			const checkIns = await this.checkInRepository.find({
				where: whereCondition,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch', 'organization'],
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				checkIns: [],
			};

			return response;
		}
	}

	async getUserCheckIns(userUid: number, organizationUid?: string): Promise<any> {
		try {
			const whereCondition: any = {
				owner: { uid: userUid }
			};
			
			if (organizationUid) {
				whereCondition.organization = { uid: organizationUid };
			}

			const checkIns = await this.checkInRepository.find({
				where: whereCondition,
				order: {
					checkInTime: 'DESC',
				},
				relations: ['owner', 'client', 'branch'],
			});

			if (!checkIns || checkIns.length === 0) {
				const response = {
					message: process.env.SUCCESS_MESSAGE,
					checkIns: [],
					user: null,
				};
				return response;
			}

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
}
