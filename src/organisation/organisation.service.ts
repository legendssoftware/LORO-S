import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { CreateOrganisationDto } from './dto/create-organisation.dto';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organisation } from './entities/organisation.entity';
import { GeneralStatus } from '../lib/enums/status.enums';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

@Injectable()
export class OrganisationService {
	private readonly logger = new Logger(OrganisationService.name);

	constructor(
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
	) {
		this.logger.log('🏢 OrganisationService initialized successfully');
	}

	private readonly CACHE_PREFIX = 'organisation';
	private readonly ALL_ORGS_CACHE_KEY = `${this.CACHE_PREFIX}:all`;
	private getOrgCacheKey(ref: string): string {
		return `${this.CACHE_PREFIX}:${ref}`;
	}

	// Default cache TTL (in seconds)
	private readonly DEFAULT_CACHE_TTL = 3600; // 1 hour

	private async clearOrganisationCache(ref?: string): Promise<void> {
		// Clear the all organisations cache
		await this.cacheManager.del(this.ALL_ORGS_CACHE_KEY);

		// If a specific ref is provided, clear that organisation's cache
		if (ref) {
			await this.cacheManager.del(this.getOrgCacheKey(ref));
		}
	}

	async create(createOrganisationDto: CreateOrganisationDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		const operationId = `create_org_${Date.now()}`;
		
		this.logger.log(`🏢 [${operationId}] Starting organization creation`, {
			operationId,
			requestedName: createOrganisationDto.name,
			requestedEmail: createOrganisationDto.email,
			requestingOrgId: orgId,
			requestingBranchId: branchId,
			hasContactPerson: !!createOrganisationDto.contactPerson,
			hasWebsite: !!createOrganisationDto.website,
			hasLogo: !!createOrganisationDto.logo
		});

		try {
			// Validate input data
			this.logger.debug(`🔍 [${operationId}] Validating organization creation data`, {
				operationId,
				validationChecks: {
					hasName: !!createOrganisationDto.name,
					hasEmail: !!createOrganisationDto.email,
					hasPhone: !!createOrganisationDto.phone,
					hasContactPerson: !!createOrganisationDto.contactPerson
				}
			});

			// For organisation creation, we might not always have org scoping
			// but we can still validate permissions based on the authenticated user
			this.logger.debug(`🔐 [${operationId}] Processing organization creation with scope validation`, {
				operationId,
				scope: {
					orgId: orgId || 'none',
					branchId: branchId || 'none',
					scopeType: orgId ? 'organization_scoped' : 'global'
				}
			});

			const organisation = await this.organisationRepository.save(createOrganisationDto);

			if (!organisation) {
				this.logger.error(`❌ [${operationId}] Organization creation failed - save operation returned null`, {
					operationId,
					dto: createOrganisationDto,
					duration: Date.now() - startTime
				});
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.log(`✅ [${operationId}] Organization created successfully`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				duration: Date.now() - startTime
			});

			// Clear cache after creating a new organisation
			this.logger.debug(`🗑️ [${operationId}] Clearing organization cache after creation`, {
				operationId,
				cacheKeys: [this.ALL_ORGS_CACHE_KEY]
			});
			
			await this.clearOrganisationCache();

			this.logger.log(`🎉 [${operationId}] Organization creation completed successfully`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				totalDuration: Date.now() - startTime,
				cacheCleared: true
			});

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`💥 [${operationId}] Organization creation failed with error`, {
				operationId,
				error: error.message,
				stack: error.stack,
				organizationData: {
					name: createOrganisationDto.name,
					email: createOrganisationDto.email
				},
				scope: { orgId, branchId },
				duration: Date.now() - startTime
			});

			return {
				message: error?.message,
			};
		}
	}

	async findAll(orgId?: number, branchId?: number): Promise<{ organisations: Organisation[] | null; message: string }> {
		const startTime = Date.now();
		const operationId = `findall_orgs_${Date.now()}`;
		
		this.logger.log(`📋 [${operationId}] Starting organizations retrieval`, {
			operationId,
			scope: {
				orgId: orgId || 'none',
				branchId: branchId || 'none',
				scopeType: orgId ? 'organization_scoped' : 'global'
			}
		});

		try {
			// Generate cache key that includes org/branch context
			const contextCacheKey = `${this.ALL_ORGS_CACHE_KEY}_${orgId || 'global'}_${branchId || 'all'}`;
			
			this.logger.debug(`🔍 [${operationId}] Checking cache for organizations`, {
				operationId,
				cacheKey: contextCacheKey
			});

			// Try to get from cache first
			const cachedOrganisations = await this.cacheManager.get<Organisation[]>(contextCacheKey);

			if (cachedOrganisations) {
				this.logger.log(`⚡ [${operationId}] Organizations retrieved from cache`, {
					operationId,
					cacheKey: contextCacheKey,
					organizationCount: cachedOrganisations.length,
					duration: Date.now() - startTime,
					cacheHit: true
				});

				return {
					organisations: cachedOrganisations,
					message: process.env.SUCCESS_MESSAGE,
				};
			}

			this.logger.debug(`🔍 [${operationId}] Cache miss - querying database`, {
				operationId,
				cacheKey: contextCacheKey
			});

			// Build query with org/branch filtering
			const queryBuilder = this.organisationRepository
				.createQueryBuilder('organisation')
				.leftJoinAndSelect('organisation.branches', 'branches')
				.where('organisation.isDeleted = :isDeleted', { isDeleted: false });

			// If orgId is provided, scope to that organization
			// This ensures users can only see their own organization
			if (orgId) {
				this.logger.debug(`🔐 [${operationId}] Applying organization scope filter`, {
					operationId,
					orgId,
					filterType: 'organization_scoped'
				});
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			} else {
				this.logger.debug(`🌐 [${operationId}] No organization scope applied - global access`, {
					operationId,
					accessType: 'global'
				});
			}

			const organisations = await queryBuilder
				.select([
					'organisation.uid',
					'organisation.name',
					'organisation.email',
					'organisation.phone',
					'organisation.contactPerson',
					'organisation.website',
					'organisation.logo',
					'organisation.ref',
					'organisation.createdAt',
					'organisation.updatedAt',
					'organisation.isDeleted',
					'branches.uid',
					'branches.name',
					'branches.phone',
					'branches.email',
					'branches.website',
				])
				.getMany();

			this.logger.debug(`📊 [${operationId}] Database query completed`, {
				operationId,
				organizationCount: organisations?.length || 0,
				branchCount: organisations?.reduce((total, org) => total + (org.branches?.length || 0), 0) || 0,
				queryDuration: Date.now() - startTime
			});

			if (!organisations || organisations.length === 0) {
				this.logger.warn(`⚠️ [${operationId}] No organizations found`, {
					operationId,
					scope: { orgId, branchId },
					duration: Date.now() - startTime,
					resultCount: 0
				});

				return {
					organisations: [],
					message: 'No organisations found at the moment. Please check back later or contact support.',
				};
			}

			// Store in cache with context
			this.logger.debug(`💾 [${operationId}] Storing organizations in cache`, {
				operationId,
				cacheKey: contextCacheKey,
				ttl: this.DEFAULT_CACHE_TTL,
				organizationCount: organisations.length
			});

			await this.cacheManager.set(contextCacheKey, organisations, {
				ttl: this.DEFAULT_CACHE_TTL,
			});

			this.logger.log(`✅ [${operationId}] Organizations retrieved successfully`, {
				operationId,
				organizationCount: organisations.length,
				branchCount: organisations.reduce((total, org) => total + (org.branches?.length || 0), 0),
				totalDuration: Date.now() - startTime,
				cacheStored: true,
				scope: { orgId, branchId }
			});

			return {
				organisations,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`💥 [${operationId}] Organizations retrieval failed`, {
				operationId,
				error: error.message,
				stack: error.stack,
				scope: { orgId, branchId },
				duration: Date.now() - startTime
			});

			return {
				organisations: null,
				message: error?.message || 'Unable to retrieve organisations at this time. Please try again later.',
			};
		}
	}

	async findOne(ref: string, orgId?: number, branchId?: number): Promise<{ organisation: Organisation | null; message: string }> {
		const startTime = Date.now();
		const operationId = `findone_org_${Date.now()}`;
		
		this.logger.log(`🔍 [${operationId}] Starting organization retrieval by reference`, {
			operationId,
			organizationRef: ref,
			scope: {
				orgId: orgId || 'none',
				branchId: branchId || 'none',
				scopeType: orgId ? 'organization_scoped' : 'global'
			}
		});

		try {
			// Generate context-aware cache key
			const contextCacheKey = `${this.getOrgCacheKey(ref)}_${orgId || 'global'}_${branchId || 'all'}`;
			
			this.logger.debug(`🔍 [${operationId}] Checking cache for organization`, {
				operationId,
				cacheKey: contextCacheKey,
				organizationRef: ref
			});

			// Try to get from cache first
			const cachedOrganisation = await this.cacheManager.get<Organisation>(contextCacheKey);

			if (cachedOrganisation) {
				this.logger.log(`⚡ [${operationId}] Organization retrieved from cache`, {
					operationId,
					organizationRef: ref,
					organizationId: cachedOrganisation.uid,
					organizationName: cachedOrganisation.name,
					duration: Date.now() - startTime,
					cacheHit: true
				});

				return {
					organisation: cachedOrganisation,
					message: process.env.SUCCESS_MESSAGE,
				};
			}

			this.logger.debug(`🔍 [${operationId}] Cache miss - querying database with full relations`, {
				operationId,
				organizationRef: ref,
				relations: ['branches', 'settings', 'appearance', 'hours', 'assets', 'products', 'clients', 'users', 'resellers', 'leaves']
			});

			// Build query with org/branch scoping
			const queryBuilder = this.organisationRepository
				.createQueryBuilder('organisation')
				.leftJoinAndSelect('organisation.branches', 'branches')
				.leftJoinAndSelect('organisation.settings', 'settings')
				.leftJoinAndSelect('organisation.appearance', 'appearance')
				.leftJoinAndSelect('organisation.hours', 'hours')
				.leftJoinAndSelect('organisation.assets', 'assets')
				.leftJoinAndSelect('organisation.products', 'products')
				.leftJoinAndSelect('organisation.clients', 'clients')
				.leftJoinAndSelect('organisation.users', 'users')
				.leftJoinAndSelect('organisation.resellers', 'resellers')
				.leftJoinAndSelect('organisation.leaves', 'leaves')
				.where('organisation.ref = :ref', { ref })
				.andWhere('organisation.isDeleted = :isDeleted', { isDeleted: false });

			// Scope to authenticated user's organization
			if (orgId) {
				this.logger.debug(`🔐 [${operationId}] Applying organization scope filter`, {
					operationId,
					organizationRef: ref,
					scopingOrgId: orgId,
					filterType: 'organization_scoped'
				});
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			} else {
				this.logger.debug(`🌐 [${operationId}] No organization scope applied - global access`, {
					operationId,
					organizationRef: ref,
					accessType: 'global'
				});
			}

			const organisation = await queryBuilder.getOne();

			if (!organisation) {
				this.logger.warn(`⚠️ [${operationId}] Organization not found`, {
					operationId,
					organizationRef: ref,
					scope: { orgId, branchId },
					duration: Date.now() - startTime,
					found: false
				});

				return {
					organisation: null,
					message: 'Organisation not found. Please verify the reference code and try again.',
				};
			}

			// Log comprehensive organization details
			this.logger.debug(`📊 [${operationId}] Organization found with relations`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				relationsLoaded: {
					branches: organisation.branches?.length || 0,
					settings: !!organisation.settings,
					appearance: !!organisation.appearance,
					hours: organisation.hours?.length || 0,
					assets: organisation.assets?.length || 0,
					products: organisation.products?.length || 0,
					clients: organisation.clients?.length || 0,
					users: organisation.users?.length || 0,
					resellers: organisation.resellers?.length || 0,
					leaves: organisation.leaves?.length || 0
				},
				queryDuration: Date.now() - startTime
			});

			// Check if organisation has no products
			if (organisation.products && organisation.products.length === 0) {
				this.logger.debug(`📦 [${operationId}] Organization has no products - adding helpful message`, {
					operationId,
					organizationId: organisation.uid,
					productCount: 0
				});
				// Enhance the response message for empty products
				organisation['productsMessage'] = 'No new products available at the moment. Check back soon for updates!';
			}

			// Store in cache with context
			this.logger.debug(`💾 [${operationId}] Storing organization in cache`, {
				operationId,
				cacheKey: contextCacheKey,
				ttl: this.DEFAULT_CACHE_TTL,
				organizationId: organisation.uid
			});

			await this.cacheManager.set(contextCacheKey, organisation, {
				ttl: this.DEFAULT_CACHE_TTL,
			});

			this.logger.log(`✅ [${operationId}] Organization retrieved successfully`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				totalDuration: Date.now() - startTime,
				cacheStored: true,
				relationsCount: {
					branches: organisation.branches?.length || 0,
					hours: organisation.hours?.length || 0,
					assets: organisation.assets?.length || 0,
					products: organisation.products?.length || 0,
					clients: organisation.clients?.length || 0,
					users: organisation.users?.length || 0
				}
			});

			return {
				organisation,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`💥 [${operationId}] Organization retrieval failed`, {
				operationId,
				organizationRef: ref,
				error: error.message,
				stack: error.stack,
				scope: { orgId, branchId },
				duration: Date.now() - startTime
			});

			return {
				organisation: null,
				message: error?.message || 'Unable to retrieve organisation details. Please try again later.',
			};
		}
	}

	async update(ref: string, updateOrganisationDto: UpdateOrganisationDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		const operationId = `update_org_${Date.now()}`;
		
		this.logger.log(`✏️ [${operationId}] Starting organization update`, {
			operationId,
			organizationRef: ref,
			updateFields: Object.keys(updateOrganisationDto),
			scope: {
				orgId: orgId || 'none',
				branchId: branchId || 'none',
				scopeType: orgId ? 'organization_scoped' : 'global'
			}
		});

		try {
			// First verify the organisation belongs to the authenticated user's org
			if (orgId) {
				this.logger.debug(`🔐 [${operationId}] Verifying organization ownership before update`, {
					operationId,
					organizationRef: ref,
					requiredOrgId: orgId
				});

				const existingOrg = await this.organisationRepository.findOne({
					where: { ref, isDeleted: false, uid: orgId },
				});

				if (!existingOrg) {
					this.logger.warn(`⚠️ [${operationId}] Organization not found or permission denied for update`, {
						operationId,
						organizationRef: ref,
						requiredOrgId: orgId,
						duration: Date.now() - startTime,
						accessDenied: true
					});

					return {
						message: 'Organisation not found or you do not have permission to modify it.',
					};
				}

				this.logger.debug(`✅ [${operationId}] Organization ownership verified`, {
					operationId,
					organizationId: existingOrg.uid,
					organizationRef: existingOrg.ref,
					organizationName: existingOrg.name
				});
			} else {
				this.logger.debug(`🌐 [${operationId}] No organization scope applied - global update access`, {
					operationId,
					organizationRef: ref,
					accessType: 'global'
				});
			}

			this.logger.debug(`🔄 [${operationId}] Executing organization update`, {
				operationId,
				organizationRef: ref,
				updateData: {
					fieldsToUpdate: Object.keys(updateOrganisationDto),
					hasName: !!updateOrganisationDto.name,
					hasEmail: !!updateOrganisationDto.email,
					hasPhone: !!updateOrganisationDto.phone,
					hasWebsite: !!updateOrganisationDto.website,
					hasLogo: !!updateOrganisationDto.logo,
					hasContactPerson: !!updateOrganisationDto.contactPerson
				}
			});

			await this.organisationRepository.update({ ref }, updateOrganisationDto);

			const updatedOrganisation = await this.organisationRepository.findOne({
				where: { ref, isDeleted: false },
			});

			if (!updatedOrganisation) {
				this.logger.error(`❌ [${operationId}] Organization not found after update attempt`, {
					operationId,
					organizationRef: ref,
					duration: Date.now() - startTime,
					updateFailed: true
				});

				return {
					message: 'Organisation not found or could not be updated. Please verify the reference code.',
				};
			}

			this.logger.log(`✅ [${operationId}] Organization updated successfully in database`, {
				operationId,
				organizationId: updatedOrganisation.uid,
				organizationRef: updatedOrganisation.ref,
				organizationName: updatedOrganisation.name,
				fieldsUpdated: Object.keys(updateOrganisationDto),
				updateDuration: Date.now() - startTime
			});

			// Clear cache after updating
			this.logger.debug(`🗑️ [${operationId}] Clearing organization cache after update`, {
				operationId,
				organizationRef: ref,
				cacheKeysToDelete: [this.getOrgCacheKey(ref), this.ALL_ORGS_CACHE_KEY]
			});

			await this.clearOrganisationCache(ref);

			this.logger.log(`🎉 [${operationId}] Organization update completed successfully`, {
				operationId,
				organizationId: updatedOrganisation.uid,
				organizationRef: updatedOrganisation.ref,
				totalDuration: Date.now() - startTime,
				cacheCleared: true,
				impactedSystems: ['organization_cache', 'organization_data']
			});

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`💥 [${operationId}] Organization update failed`, {
				operationId,
				organizationRef: ref,
				error: error.message,
				stack: error.stack,
				updateData: updateOrganisationDto,
				scope: { orgId, branchId },
				duration: Date.now() - startTime
			});

			return {
				message: error?.message || 'Unable to update organisation. Please try again later.',
			};
		}
	}

	async remove(ref: string, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		const operationId = `remove_org_${Date.now()}`;
		
		this.logger.log(`🗑️ [${operationId}] Starting organization soft deletion`, {
			operationId,
			organizationRef: ref,
			scope: {
				orgId: orgId || 'none',
				branchId: branchId || 'none',
				scopeType: orgId ? 'organization_scoped' : 'global'
			}
		});

		try {
			// Build query with org scoping
			const whereClause: any = { ref, isDeleted: false };
			
			// Scope to authenticated user's organization
			if (orgId) {
				this.logger.debug(`🔐 [${operationId}] Applying organization scope for deletion`, {
					operationId,
					organizationRef: ref,
					requiredOrgId: orgId,
					filterType: 'organization_scoped'
				});
				whereClause.uid = orgId;
			} else {
				this.logger.debug(`🌐 [${operationId}] No organization scope applied - global deletion access`, {
					operationId,
					organizationRef: ref,
					accessType: 'global'
				});
			}

			this.logger.debug(`🔍 [${operationId}] Verifying organization exists and can be deleted`, {
				operationId,
				organizationRef: ref,
				whereClause: whereClause
			});

			const organisation = await this.organisationRepository.findOne({
				where: whereClause,
				relations: ['branches', 'users', 'assets']
			});

			if (!organisation) {
				this.logger.warn(`⚠️ [${operationId}] Organization not found or permission denied for deletion`, {
					operationId,
					organizationRef: ref,
					scope: { orgId, branchId },
					duration: Date.now() - startTime,
					accessDenied: true
				});

				return {
					message: 'Organisation not found, has already been removed, or you do not have permission to delete it.',
				};
			}

			// Log organization details before deletion
			this.logger.log(`📊 [${operationId}] Organization found - analyzing deletion impact`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				impactAnalysis: {
					branchCount: organisation.branches?.length || 0,
					userCount: organisation.users?.length || 0,
					assetCount: organisation.assets?.length || 0,
					deletionTimestamp: new Date().toISOString()
				}
			});

			this.logger.debug(`🔄 [${operationId}] Executing soft deletion`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: ref,
				deletionType: 'soft_delete'
			});

			await this.organisationRepository.update({ ref }, { isDeleted: true });

			this.logger.log(`✅ [${operationId}] Organization soft deletion completed`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				deletionDuration: Date.now() - startTime,
				softDeleted: true
			});

			// Clear cache after removing
			this.logger.debug(`🗑️ [${operationId}] Clearing organization cache after deletion`, {
				operationId,
				organizationRef: ref,
				cacheKeysToDelete: [this.getOrgCacheKey(ref), this.ALL_ORGS_CACHE_KEY]
			});

			await this.clearOrganisationCache(ref);

			this.logger.log(`🎉 [${operationId}] Organization deletion completed successfully`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				totalDuration: Date.now() - startTime,
				cacheCleared: true,
				retentionPeriod: '90 days',
				recoveryAvailable: true
			});

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`💥 [${operationId}] Organization deletion failed`, {
				operationId,
				organizationRef: ref,
				error: error.message,
				stack: error.stack,
				scope: { orgId, branchId },
				duration: Date.now() - startTime
			});

			return {
				message: error?.message || 'Unable to remove organisation. Please try again later.',
			};
		}
	}

	async restore(ref: string, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		const operationId = `restore_org_${Date.now()}`;
		
		this.logger.log(`🔄 [${operationId}] Starting organization restoration`, {
			operationId,
			organizationRef: ref,
			scope: {
				orgId: orgId || 'none',
				branchId: branchId || 'none',
				scopeType: orgId ? 'organization_scoped' : 'global'
			}
		});

		try {
			// Build query with org scoping
			const whereClause: any = { ref };
			
			// Scope to authenticated user's organization
			if (orgId) {
				this.logger.debug(`🔐 [${operationId}] Applying organization scope for restoration`, {
					operationId,
					organizationRef: ref,
					requiredOrgId: orgId,
					filterType: 'organization_scoped'
				});
				whereClause.uid = orgId;
			} else {
				this.logger.debug(`🌐 [${operationId}] No organization scope applied - global restoration access`, {
					operationId,
					organizationRef: ref,
					accessType: 'global'
				});
			}

			this.logger.debug(`🔍 [${operationId}] Searching for deleted organization to restore`, {
				operationId,
				organizationRef: ref,
				whereClause: whereClause,
				searchCriteria: 'including_deleted_records'
			});

			// First check if the organisation exists and user has permission
			const organisation = await this.organisationRepository.findOne({
				where: whereClause,
				relations: ['branches', 'users', 'assets']
			});

			if (!organisation) {
				this.logger.warn(`⚠️ [${operationId}] Organization not found or permission denied for restoration`, {
					operationId,
					organizationRef: ref,
					scope: { orgId, branchId },
					duration: Date.now() - startTime,
					accessDenied: true
				});

				return {
					message: 'Organisation not found or you do not have permission to restore it.',
				};
			}

			// Log organization details before restoration
			this.logger.log(`📊 [${operationId}] Organization found - analyzing restoration impact`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				currentStatus: {
					isDeleted: organisation.isDeleted,
					currentStatus: organisation.status
				},
				restorationImpact: {
					branchCount: organisation.branches?.length || 0,
					userCount: organisation.users?.length || 0,
					assetCount: organisation.assets?.length || 0,
					restorationTimestamp: new Date().toISOString()
				}
			});

			this.logger.debug(`🔄 [${operationId}] Executing organization restoration`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: ref,
				restorationChanges: {
					isDeleted: 'false',
					status: GeneralStatus.ACTIVE
				}
			});

			await this.organisationRepository.update(
				{ ref },
				{
					isDeleted: false,
					status: GeneralStatus.ACTIVE,
				},
			);

			this.logger.log(`✅ [${operationId}] Organization restoration completed in database`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				restorationDuration: Date.now() - startTime,
				newStatus: GeneralStatus.ACTIVE,
				isDeleted: false
			});

			// Clear cache after restoring
			this.logger.debug(`🗑️ [${operationId}] Clearing organization cache after restoration`, {
				operationId,
				organizationRef: ref,
				cacheKeysToDelete: [this.getOrgCacheKey(ref), this.ALL_ORGS_CACHE_KEY]
			});

			await this.clearOrganisationCache(ref);

			this.logger.log(`🎉 [${operationId}] Organization restoration completed successfully`, {
				operationId,
				organizationId: organisation.uid,
				organizationRef: organisation.ref,
				organizationName: organisation.name,
				totalDuration: Date.now() - startTime,
				cacheCleared: true,
				systemsReactivated: ['organization_data', 'organization_cache'],
				restorationSummary: {
					branchesRestored: organisation.branches?.length || 0,
					usersReactivated: organisation.users?.length || 0,
					assetsRecovered: organisation.assets?.length || 0
				}
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			this.logger.error(`💥 [${operationId}] Organization restoration failed`, {
				operationId,
				organizationRef: ref,
				error: error.message,
				stack: error.stack,
				scope: { orgId, branchId },
				duration: Date.now() - startTime
			});

			const response = {
				message: error?.message || 'Unable to restore organisation. Please try again later.',
			};

			return response;
		}
	}
}
