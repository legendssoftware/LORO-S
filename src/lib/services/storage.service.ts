import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { Doc } from '../../docs/entities/doc.entity';
import { getStorageConfig } from '../../config/storage.config';
import { User } from '../../user/entities/user.entity';

export interface StorageFile {
	buffer: Buffer;
	mimetype: string;
	originalname: string;
	size: number;
	metadata?: Record<string, string>;
}

export interface UploadResult {
	fileName: string;
	publicUrl: string;
	metadata: Record<string, any>;
	docId?: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
	private storage: Storage;
	private bucket: string;
	private readonly logger = new Logger(StorageService.name);

	constructor(
		private readonly configService: ConfigService,
		@InjectRepository(Doc)
		private readonly docsRepository: Repository<Doc>,
		private readonly connection: Connection,
	) {
		this.bucket = this.configService.get<string>('GOOGLE_CLOUD_PROJECT_BUCKET');
	}

	onModuleInit() {
		try {
			const credentials = getStorageConfig(this.configService);

			this.storage = new Storage({
				projectId: this.configService.get<string>('GOOGLE_CLOUD_PROJECT_ID'),
				credentials,
			});

			this.logger.log(`gcs ready: ${this.bucket}`);
		} catch (error) {
			this.logger.error('failed to get gcs ready:', error);
		}
	}

	private generateFileName(file: StorageFile): string {
		const fileHash = crypto
			.createHash('md5')
			.update(Date.now().toString() + file.originalname)
			.digest('hex');
		const ext = extname(file.originalname);
		return `${fileHash}${ext}`;
	}

	private async createDocRecord(
		originalName: string,
		publicUrl: string,
		metadata: Record<string, any>,
		mimeType: string,
		fileSize: number,
		ownerId?: number,
		branchId?: number,
	): Promise<Doc> {
		// Get content type for content field
		const contentType = mimeType.split('/')[0];

		// Use docId for description if available
		const description = metadata?.docId?.toString() || '';

		const doc = this.docsRepository.create({
			title: originalName,
			content: contentType, // Use content type
			fileType: mimeType.split('/')[0],
			fileSize,
			url: publicUrl,
			mimeType,
			extension: extname(originalName),
			metadata,
			isActive: true,
			isPublic: false,
			description, // Use docId for description
			owner: ownerId ? ({ uid: ownerId } as any) : null,
			branch: branchId ? ({ uid: branchId } as any) : null,
		});

		return await this.docsRepository.save(doc);
	}

	async upload(
		file: StorageFile,
		customFileName?: string,
		ownerId?: number,
		branchId?: number,
	): Promise<UploadResult> {
		try {
			// Check if storage and bucket are properly initialized
			if (!this.storage) {
				throw new Error('Google Cloud Storage client is not initialized');
			}

			if (!this.bucket) {
				throw new Error(
					'Storage bucket name is not configured. Please check GOOGLE_CLOUD_PROJECT_BUCKET in your environment variables',
				);
			}

			const fileName = customFileName || this.generateFileName(file);
			const bucket = this.storage.bucket(this.bucket);

			const [exists] = await bucket.exists();
			if (!exists) {
				throw new Error(
					`Bucket ${this.bucket} does not exist or is not accessible. Please check your credentials and bucket name.`,
				);
			}

			// Save file in the 'loro' folder
			const filePath = `loro/${fileName}`;
			const blob = bucket.file(filePath);

			// ENHANCEMENT: Use resumable upload for larger files (> 5MB) for better performance
			// For smaller files, simple upload is faster
			const useResumable = file.size > 5 * 1024 * 1024; // 5MB threshold

			if (useResumable) {
				// Use streaming upload for larger files
				await new Promise<void>((resolve, reject) => {
					const writeStream = blob.createWriteStream({
						resumable: true,
						metadata: {
							contentType: file.mimetype,
							metadata: file.metadata,
							cacheControl: 'public, max-age=31536000', // Cache for 1 year
						},
					});

					writeStream.on('error', reject);
					writeStream.on('finish', resolve);
					writeStream.end(file.buffer);
				});
			} else {
				// Simple upload for smaller files (faster for small files)
				await blob.save(file.buffer, {
					resumable: false,
					metadata: {
						contentType: file.mimetype,
						metadata: file.metadata,
						cacheControl: 'public, max-age=31536000', // Cache for 1 year
					},
				});
			}

			await blob.makePublic();
			const publicUrl = blob.publicUrl();
			const [fileMetadata] = await blob.getMetadata();

			// Extract the user ID from metadata
			const uploadedBy = file.metadata?.uploadedBy;
			let userOwnerId = ownerId;
			let userBranchId = branchId;
			let organisationId = null;

			if (uploadedBy) {
				try {
					// Find the user by ID to get their organization
					const userRepo = this.connection.getRepository(User);
					const user = await userRepo.findOne({
						where: { uid: parseInt(uploadedBy, 10) },
						relations: ['organisation'],
					});

					if (user) {
						userOwnerId = user.uid;
						if (user.organisation) {
							organisationId = user.organisation.uid;
						}
					}

					// Use branch from metadata if available
					if (file.metadata?.branch) {
						userBranchId = parseInt(file.metadata.branch, 10);
					}
				} catch (error) {
					this.logger.error(`Error finding user: ${error.message}`);
				}
			}

			// ENHANCEMENT: Create doc record asynchronously for faster response
			// This allows faster response to client while doc record is created in background
			const docPromise = this.createDocRecord(
				file.originalname,
				publicUrl,
				fileMetadata,
				file.mimetype,
				file.size,
				userOwnerId,
				userBranchId,
			).then(async (doc) => {
				// Set organization if found
				if (organisationId) {
					await this.docsRepository.update(doc.uid, {
						organisation: { uid: organisationId } as any,
					});
				}
				return doc;
			}).catch((error) => {
				this.logger.error(`Failed to create doc record: ${error.message}`);
				return null;
			});

			// Wait for doc creation but don't block on organization update
			const doc = await docPromise;

			return {
				fileName,
				publicUrl,
				metadata: fileMetadata,
				docId: doc?.uid,
			};
		} catch (error) {
			throw new Error(`File upload failed: ${error.message}`);
		}
	}

	async delete(docId: number): Promise<void> {
		try {
			const doc = await this.docsRepository.findOne({ where: { uid: docId } });
			if (!doc) {
				throw new Error('Document not found');
			}

			const bucket = this.storage.bucket(this.bucket);

			// Extract just the filename from the URL
			const fileName = doc.url.split('/').pop();
			if (fileName) {
				// Check both the root location and the loro folder
				const fileLocations = [fileName, `loro/${fileName}`];

				// Try to delete from both possible locations
				for (const location of fileLocations) {
					const file = bucket.file(location);
					const [exists] = await file.exists();
					if (exists) {
						await file.delete();
						break; // Exit once the file is found and deleted
					}
				}
			}

			await this.docsRepository.delete(docId);
		} catch (error) {
			throw error;
		}
	}

	async getSignedUrl(fileName: string, expiresIn = 3600): Promise<string> {
		try {
			const bucket = this.storage.bucket(this.bucket);

			// Check both the root location and the loro folder
			const fileLocations = [fileName, `loro/${fileName}`];

			let url;
			// Try to get signed URL from both possible locations
			for (const location of fileLocations) {
				const file = bucket.file(location);
				const [exists] = await file.exists();
				if (exists) {
					[url] = await file.getSignedUrl({
						version: 'v4',
						action: 'read',
						expires: Date.now() + expiresIn * 1000,
					});
					break; // Exit once the file is found
				}
			}

			if (!url) {
				throw new Error(`File ${fileName} not found in bucket`);
			}

			return url;
		} catch (error) {
			throw error;
		}
	}

	async getMetadata(fileName: string): Promise<any> {
		try {
			const bucket = this.storage.bucket(this.bucket);

			// Check both the root location and the loro folder
			const fileLocations = [fileName, `loro/${fileName}`];

			let metadata;
			// Try to get metadata from both possible locations
			for (const location of fileLocations) {
				const file = bucket.file(location);
				const [exists] = await file.exists();
				if (exists) {
					[metadata] = await file.getMetadata();
					break; // Exit once the file is found
				}
			}

			if (!metadata) {
				throw new Error(`File ${fileName} not found in bucket`);
			}

			return metadata;
		} catch (error) {
			throw error;
		}
	}

	async updateDoc(docId: number, updates: Partial<Doc>): Promise<void> {
		try {
			await this.docsRepository.update(docId, updates);
		} catch (error) {
			throw error;
		}
	}
}
