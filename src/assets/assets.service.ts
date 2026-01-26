import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { Asset } from './entities/asset.entity';
import { Repository, Like } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailType } from '../lib/enums/email.enums';

@Injectable()
export class AssetsService {
	constructor(
		@InjectRepository(Asset)
		private assetRepository: Repository<Asset>,
		private eventEmitter: EventEmitter2,
	) { }

	async create(createAssetDto: CreateAssetDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const { owner, ...rest } = createAssetDto;
			const savePayload = {
				...rest,
				ownerClerkUserId: owner?.uid ?? null,
				owner: owner?.uid ? { clerkUserId: owner.uid } : undefined,
				org: { uid: orgId },
				branch: branchId ? { uid: branchId } : null,
			};
			const asset = (await this.assetRepository.save(savePayload)) as Asset;

		if (!asset) {
			throw new NotFoundException(process.env.CREATE_ERROR_MESSAGE);
		}

		// Send asset assignment notification if owner is assigned
		if (createAssetDto.owner && createAssetDto.owner.uid) {
			try {
				// Get the created asset with owner details
				const assetWithOwner = await this.assetRepository.findOne({
					where: { uid: asset.uid },
					relations: ['owner', 'branch', 'org']
				});

				if (assetWithOwner && assetWithOwner.owner) {
					this.eventEmitter.emit('send.email', EmailType.ASSET_ASSIGNED, [assetWithOwner.owner.email], {
						name: `${assetWithOwner.owner.name} ${assetWithOwner.owner.surname || ''}`.trim() || assetWithOwner.owner.email.split('@')[0],
						assetId: asset.uid,
						brand: createAssetDto.brand,
						serialNumber: createAssetDto.serialNumber,
						modelNumber: createAssetDto.modelNumber,
						purchaseDate: createAssetDto.purchaseDate,
						hasInsurance: createAssetDto.hasInsurance || false,
						insuranceProvider: createAssetDto.insuranceProvider,
						insuranceExpiryDate: createAssetDto.insuranceExpiryDate,
						owner: {
							name: `${assetWithOwner.owner.name} ${assetWithOwner.owner.surname || ''}`.trim(),
							email: assetWithOwner.owner.email,
							uid: assetWithOwner.owner.uid,
						},
						branch: assetWithOwner.branch ? { name: assetWithOwner.branch.name, uid: assetWithOwner.branch.uid } : null,
						organization: assetWithOwner.org ? { name: assetWithOwner.org.name, uid: assetWithOwner.org.uid } : { name: 'Organization', uid: orgId },
						dashboardLink: `${process.env.WEBSITE_DOMAIN}/assets/${asset.uid}`,
					});
				}
			} catch (error) {
				// Silent fail - email notification is non-critical
			}
		}

		// Send admin notification
		try {
			this.eventEmitter.emit('send.email', EmailType.ASSET_CREATED_ADMIN, ['admin@example.com'], {
				adminName: 'Administrator',
				action: 'created',
				asset: {
					id: asset.uid,
					brand: createAssetDto.brand,
					serialNumber: createAssetDto.serialNumber,
					modelNumber: createAssetDto.modelNumber,
				},
				actionBy: {
					name: 'System User', // You should get this from the current user
					email: 'system@example.com',
				},
				actionDate: new Date().toISOString(),
				actionDetails: 'Asset created in the system',
				dashboardLink: `${process.env.WEBSITE_DOMAIN}/assets/${asset.uid}`,
			});
		} catch (error) {
			// Silent fail - email notification is non-critical
		}

		return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async findAll(orgId?: number, branchId?: number): Promise<{ assets: Asset[], message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				isDeleted: false,
				org: { uid: orgId }
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const assets = await this.assetRepository.find({
				where: whereClause,
				relations: ['owner', 'branch', 'org']
			});

			if (!assets || assets?.length === 0) {
				return {
					message: process.env.SEARCH_ERROR_MESSAGE,
					assets: null
				};
			}

			return {
				assets: assets,
				message: process.env.SUCCESS_MESSAGE
			};
		} catch (error) {
			return {
				message: error?.message,
				assets: null
			};
		}
	}

	async findOne(ref: number, orgId?: number, branchId?: number): Promise<{ asset: Asset, message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				org: { uid: orgId }
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const asset = await this.assetRepository.findOne({
				where: whereClause,
				relations: ['owner', 'branch', 'org']
			});

			if (!asset) {
				throw new NotFoundException(process.env.SEARCH_ERROR_MESSAGE);
			}

			return {
				asset: asset,
				message: process.env.SUCCESS_MESSAGE
			};
		} catch (error) {
			return {
				message: error?.message,
				asset: null
			};
		}
	}

	async findBySearchTerm(query: string, orgId?: number, branchId?: number): Promise<{ assets: Asset[], message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const baseWhere = {
				isDeleted: false,
				org: { uid: orgId }
			};

			if (branchId) {
				baseWhere['branch'] = { uid: branchId };
			}

			const assets = await this.assetRepository.find({
				where: [
					{ ...baseWhere, brand: Like(`%${query}%`) },
					{ ...baseWhere, serialNumber: Like(`%${query}%`) },
					{ ...baseWhere, modelNumber: Like(`%${query}%`) },
					{ ...baseWhere, owner: { name: Like(`%${query}%`) } },
					{ ...baseWhere, branch: { name: Like(`%${query}%`) } }
				],
				relations: ['owner', 'branch', 'org']
			});

			if (!assets || assets?.length === 0) {
				throw new NotFoundException(process.env.SEARCH_ERROR_MESSAGE);
			}

			return {
				assets: assets,
				message: process.env.SUCCESS_MESSAGE
			};
		} catch (error) {
			return {
				message: error?.message,
				assets: null
			};
		}
	}

	async assetsByUser(ref: number, orgId?: number, branchId?: number): Promise<{ message: string, assets: Asset[] }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				owner: { uid: ref },
				org: { uid: orgId },
				isDeleted: false
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const assets = await this.assetRepository.find({
				where: whereClause,
				relations: ['owner', 'branch', 'org']
			});

			if (!assets) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			return {
				message: process.env.SUCCESS_MESSAGE,
				assets
			};
		} catch (error) {
			return {
				message: `could not get assets by user - ${error?.message}`,
				assets: null
			};
		}
	}

	async update(ref: number, updateAssetDto: UpdateAssetDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// First verify the asset belongs to the org/branch
			const verify = await this.findOne(ref, orgId, branchId);
			if (!verify?.asset) {
				throw new NotFoundException('Asset not found in your organization');
			}

			const { owner, ...rest } = updateAssetDto;
			const updatePayload = {
				...rest,
				...(owner?.uid != null && { ownerClerkUserId: owner.uid }),
			};
			const result = await this.assetRepository.update(ref, updatePayload);

		if (!result) {
			throw new NotFoundException(process.env.UPDATE_ERROR_MESSAGE);
		}

		// Send asset update notification if owner exists
		try {
			const updatedAsset = await this.assetRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'branch', 'org']
			});

			if (updatedAsset && updatedAsset.owner) {
				this.eventEmitter.emit('send.email', EmailType.ASSET_UPDATED, [updatedAsset.owner.email], {
					name: `${updatedAsset.owner.name} ${updatedAsset.owner.surname || ''}`.trim() || updatedAsset.owner.email.split('@')[0],
					assetId: updatedAsset.uid,
					brand: updatedAsset.brand,
					serialNumber: updatedAsset.serialNumber,
					modelNumber: updatedAsset.modelNumber,
					changes: Object.keys(updateAssetDto).join(', '),
					updateDate: new Date().toISOString(),
					owner: {
						name: `${updatedAsset.owner.name} ${updatedAsset.owner.surname || ''}`.trim(),
						email: updatedAsset.owner.email,
						uid: updatedAsset.owner.uid,
					},
					organization: updatedAsset.org ? { name: updatedAsset.org.name, uid: updatedAsset.org.uid } : { name: 'Organization', uid: orgId },
					dashboardLink: `${process.env.WEBSITE_DOMAIN}/assets/${updatedAsset.uid}`,
				});
			}
		} catch (error) {
			// Silent fail - email notification is non-critical
		}

		return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// First verify the asset belongs to the org/branch
			const asset = await this.findOne(ref, orgId, branchId);
			if (!asset) {
				throw new NotFoundException('Asset not found in your organization');
			}

					// Get asset details before deletion for email notification
		const assetToDelete = await this.assetRepository.findOne({
			where: { uid: ref },
			relations: ['owner', 'branch', 'org']
		});

		const result = await this.assetRepository.update(ref, { isDeleted: true });

		if (!result) {
			throw new NotFoundException(process.env.DELETE_ERROR_MESSAGE);
		}

		// Send asset removal notification if owner exists
		if (assetToDelete && assetToDelete.owner) {
			try {
				this.eventEmitter.emit('send.email', EmailType.ASSET_REMOVED, [assetToDelete.owner.email], {
					name: `${assetToDelete.owner.name} ${assetToDelete.owner.surname || ''}`.trim() || assetToDelete.owner.email.split('@')[0],
					assetId: assetToDelete.uid,
					brand: assetToDelete.brand,
					serialNumber: assetToDelete.serialNumber,
					modelNumber: assetToDelete.modelNumber,
					removalDate: new Date().toISOString(),
					owner: {
						name: `${assetToDelete.owner.name} ${assetToDelete.owner.surname || ''}`.trim(),
						email: assetToDelete.owner.email,
						uid: assetToDelete.owner.uid,
					},
					organization: assetToDelete.org ? { name: assetToDelete.org.name, uid: assetToDelete.org.uid } : { name: 'Organization', uid: orgId },
					dashboardLink: `${process.env.WEBSITE_DOMAIN}/assets`,
				});
			} catch (error) {
				// Silent fail - email notification is non-critical
			}
		}

		// Send admin notification
		try {
			this.eventEmitter.emit('send.email', EmailType.ASSET_DELETED_ADMIN, ['admin@example.com'], {
				adminName: 'Administrator',
				asset: {
					id: assetToDelete.uid,
					brand: assetToDelete.brand,
					serialNumber: assetToDelete.serialNumber,
					modelNumber: assetToDelete.modelNumber,
				},
				actionBy: {
					name: 'System User', // You should get this from the current user
					email: 'system@example.com',
				},
				actionDate: new Date().toISOString(),
				actionDetails: 'Asset deleted from the system',
				dashboardLink: `${process.env.WEBSITE_DOMAIN}/assets`,
			});
		} catch (error) {
			// Silent fail - email notification is non-critical
		}

		return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async restore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// First verify the asset belongs to the org/branch
			const asset = await this.findOne(ref, orgId, branchId);
			if (!asset) {
				throw new NotFoundException('Asset not found in your organization');
			}

					const result = await this.assetRepository.update(
			{ uid: ref },
			{ isDeleted: false }
		);

		if (!result) {
			throw new NotFoundException(process.env.RESTORE_ERROR_MESSAGE);
		}

		// Send asset restoration notification if owner exists
		try {
			const restoredAsset = await this.assetRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'branch', 'org']
			});

			if (restoredAsset && restoredAsset.owner) {
				this.eventEmitter.emit('send.email', EmailType.ASSET_RESTORED, [restoredAsset.owner.email], {
					name: `${restoredAsset.owner.name} ${restoredAsset.owner.surname || ''}`.trim() || restoredAsset.owner.email.split('@')[0],
					assetId: restoredAsset.uid,
					brand: restoredAsset.brand,
					serialNumber: restoredAsset.serialNumber,
					modelNumber: restoredAsset.modelNumber,
					purchaseDate: restoredAsset.purchaseDate,
					hasInsurance: restoredAsset.hasInsurance || false,
					insuranceProvider: restoredAsset.insuranceProvider,
					insuranceExpiryDate: restoredAsset.insuranceExpiryDate,
					owner: {
						name: `${restoredAsset.owner.name} ${restoredAsset.owner.surname || ''}`.trim(),
						email: restoredAsset.owner.email,
						uid: restoredAsset.owner.uid,
					},
					branch: restoredAsset.branch ? { name: restoredAsset.branch.name, uid: restoredAsset.branch.uid } : null,
					organization: restoredAsset.org ? { name: restoredAsset.org.name, uid: restoredAsset.org.uid } : { name: 'Organization', uid: orgId },
					dashboardLink: `${process.env.WEBSITE_DOMAIN}/assets/${restoredAsset.uid}`,
				});
			}
		} catch (error) {
			// Silent fail - email notification is non-critical
		}

		return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}
}
