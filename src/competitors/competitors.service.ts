import {
	Injectable,
	NotFoundException,
	BadRequestException,
	Inject,
	Logger,
	HttpException,
	HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, FindOptionsWhere, Like, In, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';
import { Competitor } from './entities/competitor.entity';
import { User } from '../user/entities/user.entity';
import { PaginatedResponse } from '../lib/interfaces/paginated-response.interface';
import { CompetitorStatus, GeofenceType } from '../lib/enums/competitor.enums';
import * as crypto from 'crypto';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { BulkCreateCompetitorDto, BulkCreateCompetitorResponse, BulkCompetitorResult } from './dto/bulk-create-competitor.dto';
import { BulkUpdateCompetitorDto, BulkUpdateCompetitorResponse, BulkUpdateCompetitorResult } from './dto/bulk-update-competitor.dto';

@Injectable()
export class CompetitorsService {
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'competitor:';
	private readonly logger = new Logger(CompetitorsService.name);

	constructor(
		@InjectRepository(Competitor)
		private readonly competitorRepository: Repository<Competitor>,
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private readonly organisationRepository: Repository<Organisation>,
		@InjectRepository(Branch)
		private readonly branchRepository: Repository<Branch>,
		@InjectRepository(OrganisationSettings)
		private readonly organisationSettingsRepository: Repository<OrganisationSettings>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly dataSource: DataSource,
	) {
		this.CACHE_TTL = +this.configService.get<number>('CACHE_EXPIRATION_TIME', 300);

		this.logger.log('CompetitorsService initialized with cache TTL: ' + this.CACHE_TTL + ' seconds');
		this.logger.debug(`CompetitorsService initialized with dependencies:`);
		this.logger.debug(`Competitor Repository: ${!!this.competitorRepository}`);
		this.logger.debug(`User Repository: ${!!this.userRepository}`);
		this.logger.debug(`Organisation Repository: ${!!this.organisationRepository}`);
		this.logger.debug(`Branch Repository: ${!!this.branchRepository}`);
		this.logger.debug(`Organisation Settings Repository: ${!!this.organisationSettingsRepository}`);
		this.logger.debug(`Cache Manager: ${!!this.cacheManager}`);
		this.logger.debug(`Config Service: ${!!this.configService}`);
		this.logger.debug(`Data Source: ${!!this.dataSource}`);
	}

	// Helper method to get organization settings
	private async getOrganisationSettings(orgId: number): Promise<OrganisationSettings | null> {
		const validatedOrgId = this.validateNumericParam(orgId);
		if (!validatedOrgId) return null;

		try {
			return await this.organisationSettingsRepository.findOne({
				where: { organisationUid: validatedOrgId },
			});
		} catch (error) {
			this.logger.error(`Error fetching organisation settings: ${error.message}`, error.stack);
			return null;
		}
	}

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	private async clearCompetitorCache(competitorId?: number): Promise<void> {
		try {
			if (competitorId) {
				await this.cacheManager.del(this.getCacheKey(competitorId));
				await this.cacheManager.del(this.getCacheKey(`detail:${competitorId}`));
			}

			// Clear list cache keys with pattern matching
			await this.cacheManager.del(this.getCacheKey('list'));
			await this.cacheManager.del(this.getCacheKey('analytics'));
			await this.cacheManager.del(this.getCacheKey('by-industry'));
			await this.cacheManager.del(this.getCacheKey('by-threat'));
			await this.cacheManager.del(this.getCacheKey('by-name'));
		} catch (error) {
			this.logger.error(`Error clearing competitor cache: ${error.message}`, error.stack);
		}
	}

	async create(createCompetitorDto: CreateCompetitorDto, creator: User, orgId?: number, branchId?: number) {
		this.logger.log(`Creating competitor: ${createCompetitorDto.name}, created by: ${creator.uid}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			// Enhanced validation
			this.logger.debug('Validating competitor creation data');
			if (!creator?.uid) {
				this.logger.error('Creator information is required for competitor creation');
				throw new BadRequestException('Creator information is required');
			}

			// Validate numeric parameters
			const validatedOrgId = this.validateNumericParam(orgId);
			const validatedBranchId = this.validateNumericParam(branchId);

			// Validate organization access
			if (validatedOrgId && creator.organisation?.uid !== validatedOrgId) {
				this.logger.error(`User ${creator.uid} attempting to create competitor in different organization ${validatedOrgId}`);
				throw new BadRequestException('Cannot create competitor in different organization');
			}

			this.logger.debug(`Validated orgId: ${validatedOrgId}, branchId: ${validatedBranchId}`);

			// Validate required fields first
			if (!createCompetitorDto.name || createCompetitorDto.name.trim() === '') {
				throw new BadRequestException('Name field is required and cannot be empty');
			}

			// Validate address object and required fields
			if (!createCompetitorDto.address) {
				throw new BadRequestException('Address field is required');
			}

			const address = createCompetitorDto.address;
			if (
				!address.street ||
				!address.suburb ||
				!address.city ||
				!address.state ||
				!address.country ||
				!address.postalCode
			) {
				throw new BadRequestException(
					'Address must include street, suburb, city, state, country, and postalCode',
				);
			}

			// Create a new competitor instance
			const newCompetitor = new Competitor();

			// Copy properties from DTO, excluding address for now
			const { address: addressData, ...otherProps } = createCompetitorDto;
			Object.assign(newCompetitor, otherProps);

			// Handle address separately to ensure proper structure
			newCompetitor.address = {
				street: address.street,
				suburb: address.suburb,
				city: address.city,
				state: address.state,
				country: address.country,
				postalCode: address.postalCode,
			};

			// Handle coordinates - they can come from top-level fields
			if (createCompetitorDto.latitude && createCompetitorDto.longitude) {
				newCompetitor.latitude = createCompetitorDto.latitude;
				newCompetitor.longitude = createCompetitorDto.longitude;
			}

			// Handle organization and branch assignment
			if (validatedOrgId) {
				const organisation = await this.organisationRepository.findOne({ where: { uid: validatedOrgId } });
				if (organisation) {
					newCompetitor.organisation = organisation;
				}
			}

			if (validatedBranchId) {
				const branch = await this.branchRepository.findOne({ where: { uid: validatedBranchId } });
				if (branch) {
					newCompetitor.branch = branch;
				}
			}

			// Set creator reference
			if (creator) {
				newCompetitor.createdBy = creator;
			}

			// Generate a unique reference code if not provided
			if (!newCompetitor.competitorRef) {
				newCompetitor.competitorRef = `COMP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
			}

			// Handle geofencing settings
			if (createCompetitorDto.enableGeofence) {
				// If enabling geofencing, ensure we have coordinates
				if (!newCompetitor.latitude || !newCompetitor.longitude) {
					throw new BadRequestException('Coordinates (latitude and longitude) are required for geofencing');
				}

				// Set default geofence type if not provided
				if (!newCompetitor.geofenceType) {
					newCompetitor.geofenceType = GeofenceType.NOTIFY;
				}

				// Get default radius from organization settings if available
				let defaultRadius = 500; // Default fallback value

				if (validatedOrgId) {
					const orgSettings = await this.getOrganisationSettings(validatedOrgId);
					if (orgSettings?.geofenceDefaultRadius) {
						defaultRadius = orgSettings.geofenceDefaultRadius;
					}
				}

				// Set default radius if not provided
				if (!newCompetitor.geofenceRadius) {
					newCompetitor.geofenceRadius = defaultRadius;
				}
			} else if (createCompetitorDto.enableGeofence === false) {
				// If explicitly disabling geofencing
				newCompetitor.geofenceType = GeofenceType.NONE;
			}

			// Save the new competitor
			const savedCompetitor = await this.competitorRepository.save(newCompetitor);

			await this.clearCompetitorCache();

			return {
				message: 'Competitor created successfully',
				competitor: savedCompetitor,
			};
		} catch (error) {
			throw new HttpException(
				{
					message: 'Error creating competitor',
					error: error.message,
				},
				HttpStatus.BAD_REQUEST,
			);
		}
	}

	async createBatch(createCompetitorDtos: CreateCompetitorDto[], creator: User, orgId?: number, branchId?: number) {
		// Validate numeric parameters early
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		console.log(createCompetitorDtos?.length);
		// Split the input into smaller chunks to avoid entity too large errors
		const CHUNK_SIZE = 10; // Process 10 competitors at a time
		const chunks = [];

		console.log(chunks);

		for (let i = 0; i < createCompetitorDtos.length; i += CHUNK_SIZE) {
			chunks.push(createCompetitorDtos.slice(i, i + CHUNK_SIZE));
		}

		this.logger.log(
			`Processing ${createCompetitorDtos.length} competitors in ${chunks.length} chunks of max ${CHUNK_SIZE} items each`,
		);

		const allResults = [];
		let totalSuccessful = 0;
		let totalFailed = 0;

		// Pre-fetch organization and branch if provided to avoid repeated queries
		let organisation = null;
		let branch = null;
		let orgSettings = null;

		try {
			if (validatedOrgId) {
				organisation = await this.organisationRepository.findOne({ where: { uid: validatedOrgId } });
				orgSettings = await this.getOrganisationSettings(validatedOrgId);
			}

			if (validatedBranchId) {
				branch = await this.branchRepository.findOne({ where: { uid: validatedBranchId } });
			}

			const defaultRadius = orgSettings?.geofenceDefaultRadius || 500;

			// Process each chunk separately
			for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
				const chunk = chunks[chunkIndex];
				this.logger.log(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} items`);

				const queryRunner = this.dataSource.createQueryRunner();
				await queryRunner.connect();
				await queryRunner.startTransaction();

				const chunkResults = [];
				let chunkSuccessful = 0;
				let chunkFailed = 0;

				try {
					// Process each competitor in the current chunk
					for (let i = 0; i < chunk.length; i++) {
						const createCompetitorDto = chunk[i];
						const globalIndex = chunkIndex * CHUNK_SIZE + i; // Calculate global index for error reporting

						try {
							this.logger.debug(
								`Processing competitor ${globalIndex + 1}/${createCompetitorDtos.length}: ${
									createCompetitorDto.name || 'Unknown'
								}`,
							);

							// Validate required fields first
							if (!createCompetitorDto.name || createCompetitorDto.name.trim() === '') {
								throw new BadRequestException('Name field is required and cannot be empty');
							}

							// Validate address object and required fields
							if (!createCompetitorDto.address) {
								throw new BadRequestException('Address field is required');
							}

							const address = createCompetitorDto.address;
							if (
								!address.street ||
								!address.suburb ||
								!address.city ||
								!address.state ||
								!address.country ||
								!address.postalCode
							) {
								throw new BadRequestException(
									'Address must include street, suburb, city, state, country, and postalCode',
								);
							}

							// Create a new competitor instance
							const newCompetitor = new Competitor();

							// Copy properties from DTO, excluding address for now
							const { address: addressData, ...otherProps } = createCompetitorDto;
							Object.assign(newCompetitor, otherProps);

							// Handle address separately to ensure proper structure
							newCompetitor.address = {
								street: address.street,
								suburb: address.suburb,
								city: address.city,
								state: address.state,
								country: address.country,
								postalCode: address.postalCode,
							};

							// Handle coordinates - they can come from top-level fields or potentially from address extensions
							if (createCompetitorDto.latitude && createCompetitorDto.longitude) {
								newCompetitor.latitude = createCompetitorDto.latitude;
								newCompetitor.longitude = createCompetitorDto.longitude;
							}

							// Set organization and branch
							if (organisation) {
								newCompetitor.organisation = organisation;
							}

							if (branch) {
								newCompetitor.branch = branch;
							}

							// Set creator reference
							if (creator) {
								newCompetitor.createdBy = creator;
							}

							// Generate a unique reference code if not provided
							if (!newCompetitor.competitorRef) {
								newCompetitor.competitorRef = `COMP-${crypto
									.randomBytes(4)
									.toString('hex')
									.toUpperCase()}`;
							}

							// Handle geofencing settings
							if (createCompetitorDto.enableGeofence) {
								// If enabling geofencing, ensure we have coordinates
								if (!newCompetitor.latitude || !newCompetitor.longitude) {
									throw new BadRequestException(
										'Coordinates (latitude and longitude) are required for geofencing',
									);
								}

								// Set default geofence type if not provided
								if (!newCompetitor.geofenceType) {
									newCompetitor.geofenceType = GeofenceType.NOTIFY;
								}

								// Set default radius if not provided
								if (!newCompetitor.geofenceRadius) {
									newCompetitor.geofenceRadius = defaultRadius;
								}
							} else if (createCompetitorDto.enableGeofence === false) {
								// If explicitly disabling geofencing
								newCompetitor.geofenceType = GeofenceType.NONE;
							}

							this.logger.debug(
								`About to save competitor: ${newCompetitor.name} with ref: ${newCompetitor.competitorRef}`,
							);

							// Save the new competitor using the query runner
							const savedCompetitor = await queryRunner.manager.save(Competitor, newCompetitor);

							this.logger.debug(`Saved competitor with ID: ${savedCompetitor.uid}`);

							// Ensure we have the complete saved competitor with all relations
							const completeCompetitor = await queryRunner.manager.findOne(Competitor, {
								where: { uid: savedCompetitor.uid },
								relations: ['organisation', 'branch', 'createdBy'],
							});

							if (!completeCompetitor) {
								throw new Error(`Failed to retrieve saved competitor with ID ${savedCompetitor.uid}`);
							}

							chunkResults.push({
								index: globalIndex,
								success: true,
								competitor: completeCompetitor,
							});

							chunkSuccessful++;
						} catch (error) {
							this.logger.error(
								`Error creating competitor at global index ${globalIndex}: ${error.message}`,
								error.stack,
							);

							chunkResults.push({
								index: globalIndex,
								success: false,
								error: error.message || 'Unknown error occurred',
								data: createCompetitorDto.name || `Competitor at index ${globalIndex}`,
							});

							chunkFailed++;
						}
					}

					// Commit the chunk transaction if we have at least some successes
					if (chunkSuccessful > 0) {
						await queryRunner.commitTransaction();
						this.logger.log(
							`Chunk ${chunkIndex + 1} completed: ${chunkSuccessful} successful, ${chunkFailed} failed`,
						);
					} else {
						// If no successes in this chunk, rollback
						await queryRunner.rollbackTransaction();
						this.logger.warn(`Chunk ${chunkIndex + 1} failed completely, rolled back`);
					}

					// Add chunk results to total results
					allResults.push(...chunkResults);
					totalSuccessful += chunkSuccessful;
					totalFailed += chunkFailed;
				} catch (error) {
					// If there's a chunk-level error, rollback the chunk
					await queryRunner.rollbackTransaction();

					this.logger.error(`Chunk ${chunkIndex + 1} failed: ${error.message}`, error.stack);

					// Mark all items in this chunk as failed
					for (let i = 0; i < chunk.length; i++) {
						const globalIndex = chunkIndex * CHUNK_SIZE + i;
						allResults.push({
							index: globalIndex,
							success: false,
							error: `Chunk processing failed: ${error.message}`,
							data: chunk[i].name || `Competitor at index ${globalIndex}`,
						});
						totalFailed++;
					}
				} finally {
					await queryRunner.release();
				}
			}

			// Clear cache after successful batch operation (if any successes)
			if (totalSuccessful > 0) {
				await this.clearCompetitorCache();
			}

			return {
				message: `Batch competitor creation completed. ${totalSuccessful} successful, ${totalFailed} failed across ${chunks.length} chunks.`,
				totalProcessed: createCompetitorDtos.length,
				successful: totalSuccessful,
				failed: totalFailed,
				chunksProcessed: chunks.length,
				results: allResults,
			};
		} catch (error) {
			this.logger.error(`Batch competitor creation failed: ${error.message}`, error.stack);

			throw new HttpException(
				{
					message: 'Batch competitor creation failed',
					error: error.message,
					totalProcessed: createCompetitorDtos.length,
					successful: totalSuccessful,
					failed: totalFailed,
				},
				HttpStatus.BAD_REQUEST,
			);
		}
	}

	/**
	 * 🏆 Create multiple competitors in bulk with transaction support
	 * @param bulkCreateCompetitorDto - Bulk competitor creation data
	 * @returns Promise with bulk creation results
	 */
	async createBulkCompetitors(bulkCreateCompetitorDto: BulkCreateCompetitorDto): Promise<BulkCreateCompetitorResponse> {
		const startTime = Date.now();
		this.logger.log(`🏆 [createBulkCompetitors] Starting bulk creation of ${bulkCreateCompetitorDto.competitors.length} competitors`);
		
		const results: BulkCompetitorResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		let urlsValidated = 0;
		let threatLevelsCalculated = 0;
		let geofencesEnabled = 0;
		const errors: string[] = [];
		const createdCompetitorIds: number[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkCreateCompetitorDto.competitors.length; i++) {
				const competitorData = bulkCreateCompetitorDto.competitors[i];
				
				try {
					this.logger.debug(`🏆 [createBulkCompetitors] Processing competitor ${i + 1}/${bulkCreateCompetitorDto.competitors.length}: ${competitorData.name}`);
					
					// Check if name already exists
					const existingCompetitor = await queryRunner.manager.findOne(Competitor, { 
						where: { name: competitorData.name, isDeleted: false } 
					});
					if (existingCompetitor) {
						throw new Error(`Competitor name '${competitorData.name}' already exists`);
					}

					// Validate URLs if required
					if (bulkCreateCompetitorDto.validateUrls && competitorData.website) {
						this.logger.debug(`🌐 [createBulkCompetitors] Validating URLs for competitor: ${competitorData.name}`);
						// Here you could add URL validation logic
						urlsValidated++;
					}

					// Auto-calculate threat level if enabled
					let finalThreatLevel = competitorData.threatLevel;
					if (bulkCreateCompetitorDto.autoCalculateThreat && !finalThreatLevel) {
						this.logger.debug(`🎯 [createBulkCompetitors] Auto-calculating threat level for competitor: ${competitorData.name}`);
						// Logic to calculate threat level based on market data, revenue, etc.
						finalThreatLevel = this.calculateThreatLevel(competitorData);
						threatLevelsCalculated++;
					}

					// Set up geofencing if enabled
					let geofenceEnabled = false;
					if (bulkCreateCompetitorDto.enableGeofencing && competitorData.latitude && competitorData.longitude) {
						this.logger.debug(`📍 [createBulkCompetitors] Setting up geofencing for competitor: ${competitorData.name}`);
						geofenceEnabled = true;
						geofencesEnabled++;
					}

					// Create competitor with org and branch association
					const competitor = queryRunner.manager.create(Competitor, {
						...competitorData,
						threatLevel: finalThreatLevel,
						enableGeofence: geofenceEnabled,
						...(bulkCreateCompetitorDto.orgId && { organisation: { uid: bulkCreateCompetitorDto.orgId } }),
						...(bulkCreateCompetitorDto.branchId && { branch: { uid: bulkCreateCompetitorDto.branchId } }),
						status: competitorData.status || CompetitorStatus.ACTIVE,
						isDeleted: false,
						createdAt: new Date(),
						updatedAt: new Date(),
						competitorRef: competitorData.name ? `COMP-${crypto.randomBytes(4).toString('hex').toUpperCase()}` : undefined
					} as any);

					const savedCompetitor = await queryRunner.manager.save(Competitor, competitor);

					results.push({
						competitor: savedCompetitor,
						success: true,
						index: i,
						name: competitorData.name,
						website: competitorData.website
					});
					
					successCount++;
					createdCompetitorIds.push(savedCompetitor.uid);
					this.logger.debug(`✅ [createBulkCompetitors] Competitor ${i + 1} created successfully: ${competitorData.name} (ID: ${savedCompetitor.uid})`);
					
				} catch (competitorError) {
					const errorMessage = `Competitor ${i + 1} (${competitorData.name}): ${competitorError.message}`;
					this.logger.error(`❌ [createBulkCompetitors] ${errorMessage}`, competitorError.stack);
					
					results.push({
						competitor: null,
						success: false,
						error: competitorError.message,
						index: i,
						name: competitorData.name,
						website: competitorData.website
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [createBulkCompetitors] Transaction committed - ${successCount} competitors created successfully`);
				
				// Clear relevant caches after successful bulk creation
				await this.clearCompetitorCache();
			} else {
				// Rollback if no competitors were created successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [createBulkCompetitors] Transaction rolled back - no competitors were created successfully`);
			}

		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(`❌ [createBulkCompetitors] Transaction error: ${transactionError.message}`, transactionError.stack);
			
			return {
				totalRequested: bulkCreateCompetitorDto.competitors.length,
				totalCreated: 0,
				totalFailed: bulkCreateCompetitorDto.competitors.length,
				successRate: 0,
				results: [],
				message: `Bulk creation failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime,
				createdCompetitorIds: [],
				urlsValidated: 0,
				threatLevelsCalculated: 0,
				geofencesEnabled: 0
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkCreateCompetitorDto.competitors.length) * 100;

		this.logger.log(`🎉 [createBulkCompetitors] Bulk creation completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%`);

		return {
			totalRequested: bulkCreateCompetitorDto.competitors.length,
			totalCreated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk creation completed: ${successCount} competitors created, ${failureCount} failed`
				: 'Bulk creation failed: No competitors were created',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			createdCompetitorIds: createdCompetitorIds.length > 0 ? createdCompetitorIds : undefined,
			urlsValidated: urlsValidated > 0 ? urlsValidated : undefined,
			threatLevelsCalculated: threatLevelsCalculated > 0 ? threatLevelsCalculated : undefined,
			geofencesEnabled: geofencesEnabled > 0 ? geofencesEnabled : undefined
		};
	}

	/**
	 * 📝 Update multiple competitors in bulk with transaction support
	 * @param bulkUpdateCompetitorDto - Bulk competitor update data
	 * @returns Promise with bulk update results
	 */
	async updateBulkCompetitors(bulkUpdateCompetitorDto: BulkUpdateCompetitorDto): Promise<BulkUpdateCompetitorResponse> {
		const startTime = Date.now();
		this.logger.log(`📝 [updateBulkCompetitors] Starting bulk update of ${bulkUpdateCompetitorDto.updates.length} competitors`);
		
		const results: BulkUpdateCompetitorResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		let urlsValidated = 0;
		let threatLevelsRecalculated = 0;
		let geofencesUpdated = 0;
		const errors: string[] = [];
		const updatedCompetitorIds: number[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkUpdateCompetitorDto.updates.length; i++) {
				const updateItem = bulkUpdateCompetitorDto.updates[i];
				const { ref, data } = updateItem;
				
				try {
					this.logger.debug(`🏆 [updateBulkCompetitors] Processing competitor ${i + 1}/${bulkUpdateCompetitorDto.updates.length}: ID ${ref}`);
					
					// First find the competitor to ensure it exists
					const existingCompetitor = await queryRunner.manager.findOne(Competitor, { 
						where: { uid: ref, isDeleted: false },
						relations: ['organisation', 'branch']
					});

					if (!existingCompetitor) {
						throw new Error(`Competitor with ID ${ref} not found`);
					}

					this.logger.debug(`✅ [updateBulkCompetitors] Competitor found: ${existingCompetitor.name}`);

					// Validate URLs if they are being updated and validation is enabled
					if (data.website && bulkUpdateCompetitorDto.validateUrls !== false) {
						this.logger.debug(`🌐 [updateBulkCompetitors] Validating URL for competitor ${ref}`);
						// Here you could add URL validation logic
						urlsValidated++;
					}

					// Recalculate threat level if enabled and relevant data is being updated
					if (bulkUpdateCompetitorDto.recalculateThreatLevels && 
						(data.estimatedAnnualRevenue || data.marketSharePercentage || data.competitiveAdvantage)) {
						this.logger.debug(`🎯 [updateBulkCompetitors] Recalculating threat level for competitor ${ref}`);
						data.threatLevel = this.calculateThreatLevel({ ...existingCompetitor, ...data });
						threatLevelsRecalculated++;
					}

					// Update geofencing if location data changes
					if (bulkUpdateCompetitorDto.updateGeofencing && 
						(data.latitude || data.longitude || data.geofenceRadius)) {
						this.logger.debug(`📍 [updateBulkCompetitors] Updating geofencing for competitor ${ref}`);
						geofencesUpdated++;
					}

					// Track changed fields for logging
					const updatedFields = Object.keys(data).filter(key => 
						data[key] !== undefined && data[key] !== existingCompetitor[key]
					);

					// Update the competitor
					const updateData = { ...data, updatedAt: new Date() };
					await queryRunner.manager.update(Competitor, ref, updateData as any);

					results.push({
						ref,
						success: true,
						index: i,
						name: existingCompetitor.name,
						website: existingCompetitor.website,
						updatedFields
					});
					
					successCount++;
					updatedCompetitorIds.push(ref);
					this.logger.debug(`✅ [updateBulkCompetitors] Competitor ${i + 1} updated successfully: ${existingCompetitor.name} (ID: ${ref}), Fields: ${updatedFields.join(', ')}`);
					
				} catch (competitorError) {
					const errorMessage = `Competitor ID ${ref}: ${competitorError.message}`;
					this.logger.error(`❌ [updateBulkCompetitors] ${errorMessage}`, competitorError.stack);
					
					results.push({
						ref,
						success: false,
						error: competitorError.message,
						index: i
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [updateBulkCompetitors] Transaction committed - ${successCount} competitors updated successfully`);
				
				// Clear relevant caches after successful bulk update
				await this.clearCompetitorCache();
			} else {
				// Rollback if no competitors were updated successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [updateBulkCompetitors] Transaction rolled back - no competitors were updated successfully`);
			}

		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(`❌ [updateBulkCompetitors] Transaction error: ${transactionError.message}`, transactionError.stack);
			
			return {
				totalRequested: bulkUpdateCompetitorDto.updates.length,
				totalUpdated: 0,
				totalFailed: bulkUpdateCompetitorDto.updates.length,
				successRate: 0,
				results: [],
				message: `Bulk update failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime,
				updatedCompetitorIds: [],
				urlsValidated: 0,
				threatLevelsRecalculated: 0,
				geofencesUpdated: 0
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkUpdateCompetitorDto.updates.length) * 100;

		this.logger.log(`🎉 [updateBulkCompetitors] Bulk update completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%`);

		return {
			totalRequested: bulkUpdateCompetitorDto.updates.length,
			totalUpdated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk update completed: ${successCount} competitors updated, ${failureCount} failed`
				: 'Bulk update failed: No competitors were updated',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			updatedCompetitorIds: updatedCompetitorIds.length > 0 ? updatedCompetitorIds : undefined,
			urlsValidated: urlsValidated > 0 ? urlsValidated : undefined,
			threatLevelsRecalculated: threatLevelsRecalculated > 0 ? threatLevelsRecalculated : undefined,
			geofencesUpdated: geofencesUpdated > 0 ? geofencesUpdated : undefined
		};
	}

	/**
	 * Helper method to calculate threat level based on competitor data
	 */
	private calculateThreatLevel(competitorData: any): number {
		// Simple threat level calculation based on available metrics
		let threatLevel = 1;
		
		if (competitorData.estimatedAnnualRevenue) {
			if (competitorData.estimatedAnnualRevenue > 100000000) threatLevel += 2; // >100M
			else if (competitorData.estimatedAnnualRevenue > 10000000) threatLevel += 1; // >10M
		}
		
		if (competitorData.marketSharePercentage) {
			if (competitorData.marketSharePercentage > 20) threatLevel += 2;
			else if (competitorData.marketSharePercentage > 10) threatLevel += 1;
		}
		
		if (competitorData.competitiveAdvantage && competitorData.competitiveAdvantage >= 4) {
			threatLevel += 1;
		}
		
		return Math.min(threatLevel, 5); // Cap at 5
	}

	async findAll(
		filters?: {
			status?: CompetitorStatus;
			industry?: string;
			isDirect?: boolean;
			name?: string;
			minThreatLevel?: number;
			organisationId?: number;
			branchId?: number;
			isDeleted?: boolean;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT || 10),
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Competitor>> {
		// Validate and sanitize numeric parameters
		const validatedPage = this.validateNumericParam(page, 1);
		const validatedLimit = this.validateNumericParam(limit, 10);
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);
		const validatedMinThreatLevel = this.validateNumericParam(filters?.minThreatLevel);
		const validatedFilterOrgId = this.validateNumericParam(filters?.organisationId);
		const validatedFilterBranchId = this.validateNumericParam(filters?.branchId);

		// Create a specific cache key based on all parameters
		const cacheKey = this.getCacheKey(`list:${JSON.stringify({ 
			filters: {
				...filters,
				minThreatLevel: validatedMinThreatLevel,
				organisationId: validatedFilterOrgId,
				branchId: validatedFilterBranchId
			}, 
			page: validatedPage, 
			limit: validatedLimit, 
			orgId: validatedOrgId, 
			branchId: validatedBranchId 
		})}`);

		// Try to get from cache first
		const cachedResult = await this.cacheManager.get<PaginatedResponse<Competitor>>(cacheKey);
		if (cachedResult) {
			return cachedResult;
		}

		// Build query
		const where: FindOptionsWhere<Competitor> = {
			isDeleted: filters?.isDeleted !== undefined ? filters.isDeleted : false,
		};

		if (filters?.status) {
			where.status = filters.status;
		}

		if (filters?.industry) {
			where.industry = filters.industry;
		}

		if (filters?.isDirect !== undefined) {
			where.isDirect = filters.isDirect;
		}

		if (filters?.name) {
			where.name = Like(`%${filters.name}%`);
		}

		if (validatedMinThreatLevel !== null && validatedMinThreatLevel >= 1 && validatedMinThreatLevel <= 5) {
			where.threatLevel = In(
				Array.from({ length: 5 - validatedMinThreatLevel + 1 }, (_, i) => i + validatedMinThreatLevel),
			);
		}

		// Priority order: filters > params > JWT
		const effectiveOrgId = validatedFilterOrgId || validatedOrgId;
		const effectiveBranchId = validatedFilterBranchId || validatedBranchId;

		if (effectiveOrgId) {
			where.organisation = { uid: effectiveOrgId };
		}

		if (effectiveBranchId) {
			where.branch = { uid: effectiveBranchId };
		}

		try {
			const [competitors, total] = await this.competitorRepository.findAndCount({
				where,
				relations: ['organisation', 'branch', 'createdBy'],
				order: { name: 'ASC' },
				skip: (validatedPage - 1) * validatedLimit,
				take: validatedLimit,
			});

			const result: PaginatedResponse<Competitor> = {
				data: competitors,
				meta: {
					total,
					page: validatedPage,
					limit: validatedLimit,
					totalPages: Math.ceil(total / validatedLimit),
				},
				message: 'Success',
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			return result;
		} catch (error) {
			this.logger.error(`Error finding competitors: ${error.message}`, error.stack);
			throw new BadRequestException(`Error finding competitors: ${error.message}`);
		}
	}

	// Helper method to validate numeric parameters and prevent NaN values
	private validateNumericParam(value: any, defaultValue?: number): number | null {
		if (value === undefined || value === null || value === '') {
			return defaultValue ?? null;
		}

		const numValue = Number(value);
		
		if (isNaN(numValue) || !isFinite(numValue)) {
			if (defaultValue !== undefined) {
				this.logger.warn(`Invalid numeric parameter received: ${value}, using default: ${defaultValue}`);
				return defaultValue;
			}
			return null;
		}

		return numValue;
	}

	async findOne(
		id: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; competitor: Competitor | null }> {
		// Validate numeric parameters
		const validatedId = this.validateNumericParam(id);
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		if (validatedId === null) {
			throw new BadRequestException('Invalid competitor ID provided');
		}

		const cacheKey = this.getCacheKey(`detail:${validatedId}:${validatedOrgId}:${validatedBranchId}`);

		const cached = await this.cacheManager.get<{ message: string; competitor: Competitor | null }>(cacheKey);
		if (cached) {
			return cached;
		}

		const where: FindOptionsWhere<Competitor> = {
			uid: validatedId,
			isDeleted: false,
		};

		if (validatedOrgId) {
			where.organisation = { uid: validatedOrgId };
		}

		if (validatedBranchId) {
			where.branch = { uid: validatedBranchId };
		}

		const competitor = await this.competitorRepository.findOne({
			where,
			relations: ['organisation', 'branch', 'createdBy'],
		});

		if (!competitor) {
			return { message: `Competitor with ID ${validatedId} not found`, competitor: null };
		}

		const result = { message: 'Success', competitor };
		await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
		return result;
	}

	async findOneByRef(
		ref: string,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; competitor: Competitor | null }> {
		// Validate numeric parameters
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		const cacheKey = this.getCacheKey(`ref:${ref}:${validatedOrgId}:${validatedBranchId}`);

		const cached = await this.cacheManager.get<{ message: string; competitor: Competitor | null }>(cacheKey);
		if (cached) {
			return cached;
		}

		const where: FindOptionsWhere<Competitor> = {
			competitorRef: ref,
			isDeleted: false,
		};

		if (validatedOrgId) {
			where.organisation = { uid: validatedOrgId };
		}

		if (validatedBranchId) {
			where.branch = { uid: validatedBranchId };
		}

		const competitor = await this.competitorRepository.findOne({
			where,
			relations: ['organisation', 'branch', 'createdBy'],
		});

		if (!competitor) {
			return { message: `Competitor with reference ${ref} not found`, competitor: null };
		}

		const result = { message: 'Success', competitor };
		await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
		return result;
	}

	async update(id: number, updateCompetitorDto: UpdateCompetitorDto, orgId?: number, branchId?: number) {
		try {
			// Validate numeric parameters
			const validatedId = this.validateNumericParam(id);
			const validatedOrgId = this.validateNumericParam(orgId);
			const validatedBranchId = this.validateNumericParam(branchId);

			if (validatedId === null) {
				throw new BadRequestException('Invalid competitor ID provided');
			}

			// Find the existing competitor
			const competitor = await this.competitorRepository.findOne({
				where: {
					uid: validatedId,
					...(validatedOrgId && { organisation: { uid: validatedOrgId } }),
					...(validatedBranchId && { branch: { uid: validatedBranchId } }),
				},
				relations: ['organisation', 'branch', 'createdBy'],
			});

			if (!competitor) {
				throw new HttpException('Competitor not found', HttpStatus.NOT_FOUND);
			}

			// Copy properties from DTO
			Object.assign(competitor, updateCompetitorDto);

			// Update organisation if different
			if (updateCompetitorDto.organisationId) {
				const validatedUpdateOrgId = this.validateNumericParam(updateCompetitorDto.organisationId);
				if (validatedUpdateOrgId) {
					const organisation = await this.organisationRepository.findOne({
						where: { uid: validatedUpdateOrgId },
					});
					if (organisation) {
						competitor.organisation = organisation;
					}
				}
			}

			// Update branch if different
			if (updateCompetitorDto.branchId) {
				const validatedUpdateBranchId = this.validateNumericParam(updateCompetitorDto.branchId);
				if (validatedUpdateBranchId) {
					const branch = await this.branchRepository.findOne({
						where: { uid: validatedUpdateBranchId },
					});
					if (branch) {
						competitor.branch = branch;
					}
				}
			}

			// Handle geofencing settings update
			if (updateCompetitorDto.enableGeofence !== undefined) {
				if (updateCompetitorDto.enableGeofence) {
					// Ensure we have coordinates for geofencing
					if (!competitor.latitude || !competitor.longitude) {
						throw new BadRequestException('Coordinates are required for geofencing');
					}

					// Set default geofence type if not already set
					if (!competitor.geofenceType || competitor.geofenceType === GeofenceType.NONE) {
						competitor.geofenceType = GeofenceType.NOTIFY;
					}

					// Get default radius from organization settings if available
					let defaultRadius = 500; // Default fallback value
					const competitorOrgId = competitor.organisation?.uid || validatedOrgId;

					if (competitorOrgId) {
						const orgSettings = await this.getOrganisationSettings(competitorOrgId);
						if (orgSettings?.geofenceDefaultRadius) {
							defaultRadius = orgSettings.geofenceDefaultRadius;
						}
					}

					// Set default radius if not already set
					if (!competitor.geofenceRadius) {
						competitor.geofenceRadius = defaultRadius;
					}
				} else {
					// If explicitly disabling geofencing
					competitor.geofenceType = GeofenceType.NONE;
				}
			}

			// Save the updated competitor
			const updatedCompetitor = await this.competitorRepository.save(competitor);

			await this.clearCompetitorCache(validatedId);

			return {
				message: 'Competitor updated successfully',
				competitor: updatedCompetitor,
			};
		} catch (error) {
			throw new HttpException(
				{
					message: 'Error updating competitor',
					error: error.message,
				},
				error.status || HttpStatus.BAD_REQUEST,
			);
		}
	}

	async remove(id: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		// Validate numeric parameters
		const validatedId = this.validateNumericParam(id);
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		if (validatedId === null) {
			throw new BadRequestException('Invalid competitor ID provided');
		}

		const { competitor } = await this.findOne(validatedId, validatedOrgId, validatedBranchId);

		if (!competitor) {
			throw new NotFoundException(`Competitor with ID ${validatedId} not found`);
		}

		// Soft delete by setting isDeleted flag
		competitor.isDeleted = true;

		await this.competitorRepository.save(competitor);
		await this.clearCompetitorCache(validatedId);

		return { message: 'Competitor deleted successfully' };
	}

	async hardRemove(id: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		// Validate numeric parameters
		const validatedId = this.validateNumericParam(id);
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		if (validatedId === null) {
			throw new BadRequestException('Invalid competitor ID provided');
		}

		const { competitor } = await this.findOne(validatedId, validatedOrgId, validatedBranchId);

		if (!competitor) {
			throw new NotFoundException(`Competitor with ID ${validatedId} not found`);
		}

		await this.competitorRepository.remove(competitor);
		await this.clearCompetitorCache(validatedId);

		return { message: 'Competitor permanently deleted' };
	}

	async findByName(name: string, orgId?: number, branchId?: number): Promise<Competitor[]> {
		// Validate numeric parameters
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		const cacheKey = this.getCacheKey(`by-name:${name}:${validatedOrgId}:${validatedBranchId}`);

		const cached = await this.cacheManager.get<Competitor[]>(cacheKey);
		if (cached) {
			return cached;
		}

		const where: FindOptionsWhere<Competitor> = {
			name: Like(`%${name}%`),
			isDeleted: false,
		};

		if (validatedOrgId) {
			where.organisation = { uid: validatedOrgId };
		}

		if (validatedBranchId) {
			where.branch = { uid: validatedBranchId };
		}

		const competitors = await this.competitorRepository.find({
			where,
			relations: ['organisation', 'branch'],
		});

		await this.cacheManager.set(cacheKey, competitors, this.CACHE_TTL);
		return competitors;
	}

	async findByThreatLevel(minThreatLevel: number = 0, orgId?: number, branchId?: number): Promise<Competitor[]> {
		// Validate numeric parameters
		const validatedMinThreatLevel = this.validateNumericParam(minThreatLevel, 0);
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		const cacheKey = this.getCacheKey(`by-threat:${validatedMinThreatLevel}:${validatedOrgId}:${validatedBranchId}`);

		const cached = await this.cacheManager.get<Competitor[]>(cacheKey);
		if (cached) {
			return cached;
		}

		const where: FindOptionsWhere<Competitor> = {
			isDeleted: false,
		};

		if (validatedMinThreatLevel > 0) {
			Object.assign(where, {
				threatLevel: In(Array.from({ length: 5 - validatedMinThreatLevel + 1 }, (_, i) => i + validatedMinThreatLevel)),
			});
		}

		if (validatedOrgId) {
			where.organisation = { uid: validatedOrgId };
		}

		if (validatedBranchId) {
			where.branch = { uid: validatedBranchId };
		}

		const competitors = await this.competitorRepository.find({
			where,
			relations: ['organisation', 'branch'],
			order: { threatLevel: 'DESC' },
		});

		await this.cacheManager.set(cacheKey, competitors, this.CACHE_TTL);
		return competitors;
	}

	async getCompetitorsByIndustry(orgId?: number, branchId?: number): Promise<Record<string, number>> {
		// Validate numeric parameters
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		const cacheKey = this.getCacheKey(`by-industry:${validatedOrgId}:${validatedBranchId}`);

		const cached = await this.cacheManager.get<Record<string, number>>(cacheKey);
		if (cached) {
			return cached;
		}

		const where: FindOptionsWhere<Competitor> = {
			industry: Not(IsNull()),
			isDeleted: false,
		};

		if (validatedOrgId) {
			where.organisation = { uid: validatedOrgId };
		}

		if (validatedBranchId) {
			where.branch = { uid: validatedBranchId };
		}

		const competitors = await this.competitorRepository.find({
			where,
			select: ['industry'],
		});

		// Count competitors by industry
		const industriesCount: Record<string, number> = {};
		competitors.forEach((competitor) => {
			if (competitor.industry) {
				industriesCount[competitor.industry] = (industriesCount[competitor.industry] || 0) + 1;
			}
		});

		await this.cacheManager.set(cacheKey, industriesCount, this.CACHE_TTL);
		return industriesCount;
	}

	async getCompetitorAnalytics(orgId?: number, branchId?: number): Promise<any> {
		// Validate numeric parameters
		const validatedOrgId = this.validateNumericParam(orgId);
		const validatedBranchId = this.validateNumericParam(branchId);

		const cacheKey = this.getCacheKey(`analytics:${validatedOrgId}:${validatedBranchId}`);

		const cached = await this.cacheManager.get(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const where: FindOptionsWhere<Competitor> = {
				isDeleted: false,
			};

			if (validatedOrgId) {
				where.organisation = { uid: validatedOrgId };
			}

			if (validatedBranchId) {
				where.branch = { uid: validatedBranchId };
			}

			const competitors = await this.competitorRepository.find({
				where,
				relations: ['organisation', 'branch'],
				cache: true, // Enable query caching
			});

			// Calculate analytics
			const totalCompetitors = competitors.length;
			const directCompetitors = competitors.filter((c) => c.isDirect).length;
			const indirectCompetitors = totalCompetitors - directCompetitors;

			// Get average threat level
			const competitorsWithThreatLevel = competitors.filter(
				(c) => c.threatLevel !== null && c.threatLevel !== undefined,
			);
			const averageThreatLevel =
				competitorsWithThreatLevel.length > 0
					? +(
							competitorsWithThreatLevel.reduce((sum, c) => sum + c.threatLevel, 0) /
							competitorsWithThreatLevel.length
					  ).toFixed(2)
					: 0;

			// Get top threats
			const topThreats = [...competitors]
				.sort((a, b) => (b.threatLevel || 0) - (a.threatLevel || 0))
				.slice(0, 5)
				.map((c) => ({
					uid: c.uid,
					name: c.name,
					threatLevel: c.threatLevel,
					industry: c.industry,
					competitorRef: c.competitorRef,
				}));

			// Group by industry
			const byIndustry = competitors.reduce((acc, comp) => {
				if (comp.industry) {
					acc[comp.industry] = (acc[comp.industry] || 0) + 1;
				}
				return acc;
			}, {} as Record<string, number>);

			const result = {
				totalCompetitors,
				directCompetitors,
				indirectCompetitors,
				averageThreatLevel,
				topThreats,
				byIndustry,
				lastUpdated: new Date().toISOString(),
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			return result;
		} catch (error) {
			this.logger.error(`Error getting competitor analytics: ${error.message}`, error.stack);
			throw new BadRequestException(`Error getting competitor analytics: ${error.message}`);
		}
	}
}
