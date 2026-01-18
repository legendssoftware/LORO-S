import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateDocDto } from './dto/create-doc.dto';
import { UpdateDocDto } from './dto/update-doc.dto';
import { BulkUploadDocDto, BulkUploadDocResponse, BulkFileUploadResult } from './dto/bulk-upload-doc.dto';
import { Doc } from './entities/doc.entity';
import { DeepPartial, Repository, DataSource } from 'typeorm';
import { StorageService } from '../lib/services/storage.service';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class DocsService {
	private readonly logger = new Logger(DocsService.name);
	private readonly CACHE_PREFIX = 'docs:';
	private readonly CACHE_TTL: number;

	constructor(
		@InjectRepository(Doc)
		private readonly docsRepository: Repository<Doc>,
		private readonly storageService: StorageService,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly eventEmitter: EventEmitter2,
		private readonly dataSource: DataSource,
	) {
		this.CACHE_TTL = Number(this.configService.get<string>('CACHE_EXPIRATION_TIME')) || 30;
	}

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * 🗑️ Invalidate document caches
	 * @param docId - Document ID to invalidate cache for
	 */
	private async invalidateDocumentCache(docId?: number): Promise<void> {
		try {
			const keysToDelete = [`${this.CACHE_PREFIX}all`, `${this.CACHE_PREFIX}stats`];
			
			if (docId) {
				keysToDelete.push(this.getCacheKey(docId));
			}

			// Clear pagination and search caches
			const keys = await this.cacheManager.store.keys();
			const docListCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}page`) ||
					key.startsWith(`${this.CACHE_PREFIX}search`) ||
					key.startsWith(`${this.CACHE_PREFIX}user`)
			);
			keysToDelete.push(...docListCaches);

			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));

			// Emit cache invalidation event
			this.eventEmitter.emit('docs.cache.invalidate', {
				docId,
				keys: keysToDelete,
				timestamp: new Date(),
			});
		} catch (error) {
			this.logger.error(`❌ [invalidateDocumentCache] Error invalidating document cache: ${error.message}`, error.stack);
		}
	}

	/**
	 * 🎨 Optimize image: resize, compress, convert to WebP
	 * Only processes if file is an image, returns original if not an image or optimization fails
	 */
	private async optimizeImageIfNeeded(
		buffer: Buffer,
		mimetype: string,
		originalname: string,
	): Promise<{ buffer: Buffer; mimetype: string; originalname: string; originalSize: number; optimizedSize: number }> {
		// Only optimize images
		if (!mimetype?.startsWith('image/')) {
			return {
				buffer,
				mimetype,
				originalname,
				originalSize: buffer.length,
				optimizedSize: buffer.length,
			};
		}

		try {
			const originalSize = buffer.length;
			const sharp = require('sharp');

			let pipeline = sharp(buffer);

			// Get image metadata
			const metadata = await pipeline.metadata();
			const { width, height, format } = metadata;

			// OPTIMIZATION 1: More aggressive resizing
			const MAX_DIMENSION = 1920;
			const MOBILE_MAX_DIMENSION = 1280;
			
			if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
				const targetDimension = originalSize > 2 * 1024 * 1024 ? MOBILE_MAX_DIMENSION : MAX_DIMENSION;
				pipeline = pipeline.resize(targetDimension, targetDimension, {
					fit: 'inside',
					withoutEnlargement: true,
				});
			}

			// OPTIMIZATION 2: Convert to WebP for better compression (except if already WebP or very small)
			let outputFormat = 'webp';
			let outputMimetype = 'image/webp';
			let outputName = originalname.replace(/\.[^.]+$/, '.webp');

			// If already WebP or very small (< 20KB), keep original format but optimize
			if (format === 'webp' || originalSize < 20000) {
				outputFormat = format || 'jpeg';
				outputMimetype = mimetype;
				outputName = originalname;
			}

			// OPTIMIZATION 3: Adaptive quality based on file size
			const getQuality = (size: number): number => {
				if (size > 2 * 1024 * 1024) return 70; // Large files: lower quality
				if (size > 500 * 1024) return 75; // Medium files
				return 80; // Small files: higher quality
			};

			const quality = getQuality(originalSize);

			// Apply compression based on format
			if (outputFormat === 'webp') {
				pipeline = pipeline.webp({
					quality: quality,
					effort: 6, // Increased for better compression
					smartSubsample: true,
					lossless: false,
				});
			} else if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
				pipeline = pipeline.jpeg({
					quality: quality,
					progressive: true,
					mojpegg: true,
					optimiseScans: true,
				});
			} else if (outputFormat === 'png') {
				pipeline = pipeline.png({
					compressionLevel: 9,
					adaptiveFiltering: true,
					palette: true,
				});
			}

			const optimizedBuffer = await pipeline.toBuffer();
			const optimizedSize = optimizedBuffer.length;
			
			// Safety check: if optimization increased size, use original
			if (optimizedSize >= originalSize) {
				this.logger.warn(`⚠️ [optimizeImageIfNeeded] Optimization increased size, using original`);
				return {
					buffer,
					mimetype,
					originalname,
					originalSize,
					optimizedSize: originalSize,
				};
			}

			return {
				buffer: optimizedBuffer,
				mimetype: outputMimetype,
				originalname: outputName,
				originalSize,
				optimizedSize,
			};
		} catch (error) {
			// If optimization fails, return original
			this.logger.error(`❌ [optimizeImageIfNeeded] Optimization failed, using original: ${error.message}`, error.stack);
			return {
				buffer,
				mimetype,
				originalname,
				originalSize: buffer.length,
				optimizedSize: buffer.length,
			};
		}
	}

	/**
	 * 📤 Upload a single file with comprehensive validation and logging
	 * ENHANCED: Automatically optimizes images before upload
	 * @param file - Multer file object
	 * @param type - Optional file type categorization
	 * @param ownerId - File owner user ID
	 * @param branchId - Branch ID for organization scoping
	 * @returns Upload result with file metadata
	 */
	async uploadFile(file: Express.Multer.File, type?: string, ownerId?: number, branchId?: number) {
		const startTime = Date.now();
		this.logger.log(`📤 [uploadFile] Starting file upload: ${file?.originalname || 'unknown'} (${file?.size || 0} bytes)`);

		try {
			// ============================================================
			// CRITICAL PATH: Operations that must complete before response
			// ============================================================

			// Validate file
			if (!file || !file.buffer) {
				throw new Error('Invalid file: No file data provided');
			}

			if (file.size <= 0) {
				throw new Error('Invalid file: File is empty');
			}

			// Validate file type if specified
			if (type && !this.isValidFileType(file.mimetype, type)) {
				throw new Error(`Invalid file type: ${file.mimetype} for specified type: ${type}`);
			}

			// ENHANCEMENT: Optimize image if it's an image file
			const optimizationResult = await this.optimizeImageIfNeeded(
				file.buffer,
				file.mimetype,
				file.originalname,
			);

			// Log optimization results if image was optimized
			if (optimizationResult.originalSize !== optimizationResult.optimizedSize) {
				const compressionRatio = ((optimizationResult.originalSize - optimizationResult.optimizedSize) / optimizationResult.originalSize * 100).toFixed(1);
				this.logger.log(`📉 [uploadFile] Image optimized: ${optimizationResult.originalSize} → ${optimizationResult.optimizedSize} bytes (${compressionRatio}% reduction)`);
			}

			// Core operation: Upload to storage and create doc record
			const result = await this.storageService.upload(
				{
					buffer: optimizationResult.buffer,
					mimetype: optimizationResult.mimetype,
					originalname: optimizationResult.originalname,
					size: optimizationResult.optimizedSize,
					metadata: {
						type,
						uploadedBy: ownerId?.toString(),
						branch: branchId?.toString(),
						originalSize: optimizationResult.originalSize.toString(),
						optimizedSize: optimizationResult.optimizedSize.toString(),
						wasOptimized: (optimizationResult.originalSize !== optimizationResult.optimizedSize).toString(),
					},
				},
				undefined,
				ownerId,
				branchId,
			);

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful upload
			// ============================================================
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [uploadFile] File uploaded successfully in ${duration}ms: ${file.originalname} - returning response to client`);

			const response = {
				message: 'File uploaded successfully',
				...result,
				// Include optimization info if image was optimized
				...(optimizationResult.originalSize !== optimizationResult.optimizedSize && {
					originalSize: optimizationResult.originalSize,
					optimizedSize: optimizationResult.optimizedSize,
					compressionRatio: parseFloat(((optimizationResult.originalSize - optimizationResult.optimizedSize) / optimizationResult.originalSize * 100).toFixed(1)),
				}),
			};

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					// 1. Invalidate caches (non-critical, can happen in background)
					try {
						await this.invalidateDocumentCache();
					} catch (cacheError) {
						this.logger.error(
							`❌ [uploadFile] Failed to invalidate cache: ${cacheError.message}`,
							cacheError.stack,
						);
						// Don't fail post-processing if cache invalidation fails
					}

					// 2. Emit upload event (non-critical, can happen in background)
					try {
						this.eventEmitter.emit('docs.file.uploaded', {
							fileName: file.originalname,
							fileSize: optimizationResult.optimizedSize,
							originalSize: optimizationResult.originalSize,
							mimeType: optimizationResult.mimetype,
							type,
							ownerId,
							branchId,
							uploadUrl: result.publicUrl,
							wasOptimized: optimizationResult.originalSize !== optimizationResult.optimizedSize,
							timestamp: new Date(),
						});
					} catch (eventError) {
						this.logger.error(
							`❌ [uploadFile] Failed to emit upload event: ${eventError.message}`,
							eventError.stack,
						);
						// Don't fail post-processing if event emission fails
					}
				} catch (backgroundError) {
					// Log errors but don't affect user experience since response already sent
					this.logger.error(
						`❌ [uploadFile] Background processing failed for file ${file.originalname}: ${backgroundError.message}`,
						backgroundError.stack,
					);
				}
			});

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [uploadFile] File upload failed after ${duration}ms: ${error.message}`, error.stack);
			throw new Error(`File upload failed: ${error.message}`);
		}
	}

	private isValidFileType(mimetype: string, type: string): boolean {
		const typeMap: Record<string, string[]> = {
			image: ['image/jpeg', 'image/png', 'image/gif'],
			document: [
				'application/pdf',
				'application/msword',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			],
			spreadsheet: [
				'application/vnd.ms-excel',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			],
			text: ['text/plain'],
		};

		return !typeMap[type] || typeMap[type].includes(mimetype);
	}

	/**
	 * ⬇️ Generate secure download URL for document
	 * @param docId - Document ID
	 * @returns Signed download URL with metadata
	 */
	async getDownloadUrl(docId: number) {
		const startTime = Date.now();
		this.logger.log(`⬇️ [getDownloadUrl] Generating download URL for document: ${docId}`);

		try {
			const doc = await this.docsRepository.findOne({
				where: { uid: docId },
			});

			if (!doc) {
				this.logger.warn(`⚠️ [getDownloadUrl] Document not found: ${docId}`);
				throw new NotFoundException('Document not found');
			}

			this.logger.debug(`✅ [getDownloadUrl] Document found: ${doc.title} (${doc.mimeType})`);

			// Extract filename from URL
			const fileName = doc.url.split('/').pop();
			if (!fileName) {
				this.logger.error(`❌ [getDownloadUrl] Invalid document URL: ${doc.url}`);
				throw new NotFoundException('Invalid document URL');
			}

			this.logger.debug(`🔗 [getDownloadUrl] Generating signed URL for file: ${fileName}`);

			const signedUrl = await this.storageService.getSignedUrl(fileName);

			// Emit download request event for audit logging
			this.eventEmitter.emit('docs.download.requested', {
				docId,
				fileName: doc.title,
				originalFileName: fileName,
				mimeType: doc.mimeType,
				timestamp: new Date(),
			});

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [getDownloadUrl] Download URL generated successfully in ${duration}ms for: ${doc.title}`);

			return {
				message: 'Download URL generated successfully',
				url: signedUrl,
				fileName: doc.title,
				mimeType: doc.mimeType,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [getDownloadUrl] Failed to generate download URL after ${duration}ms: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 📄 Create a new document record
	 * @param createDocDto - Document data
	 * @returns Created document confirmation
	 */
	async create(createDocDto: CreateDocDto) {
		const startTime = Date.now();
		this.logger.log(`📄 [create] Creating new document: ${createDocDto.title || 'Untitled'}`);

		try {
			this.logger.debug(`📄 [create] Document data: ${JSON.stringify(createDocDto)}`);

			const doc = await this.docsRepository.save(createDocDto as unknown as DeepPartial<Doc>);

			if (!doc) {
				throw new NotFoundException('Failed to create document');
			}

			// Invalidate caches after creation
			await this.invalidateDocumentCache();

			// Emit document creation event
			this.eventEmitter.emit('docs.document.created', {
				docId: doc.uid,
				title: doc.title,
				type: createDocDto.fileType,
				timestamp: new Date(),
			});

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [create] Document created successfully in ${duration}ms: ${doc.title} (ID: ${doc.uid})`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Document created successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [create] Failed to create document after ${duration}ms: ${error.message}`, error.stack);
			return {
				message: error.message,
			};
		}
	}

	/**
	 * 📋 Retrieve all documents with caching
	 * @returns Array of documents or null if none found
	 */
	async findAll(): Promise<{ docs: Doc[] | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`📋 [findAll] Retrieving all documents`);

		try {
			// Check cache first
			const cacheKey = this.getCacheKey('all');
			const cachedDocs = await this.cacheManager.get<{ docs: Doc[]; message: string }>(cacheKey);

			if (cachedDocs) {
				const duration = Date.now() - startTime;
				this.logger.debug(`📋 [findAll] Cache hit - returned ${cachedDocs.docs.length} documents in ${duration}ms`);
				return cachedDocs;
			}

			this.logger.debug(`📋 [findAll] Cache miss - querying database`);

			const docs = await this.docsRepository.find({
				relations: ['owner', 'branch'],
				order: { createdAt: 'DESC' }
			});

			if (!docs || docs.length === 0) {
				this.logger.warn(`⚠️ [findAll] No documents found`);
				const response = {
					message: 'No documents found',
					docs: [],
				};
				return response;
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Documents retrieved successfully',
				docs: docs,
			};

			// Cache the results
			await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [findAll] Retrieved ${docs.length} documents successfully in ${duration}ms`);

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [findAll] Failed to retrieve documents after ${duration}ms: ${error.message}`, error.stack);
			
			const response = {
				message: `Failed to retrieve documents: ${error.message}`,
				docs: null,
			};

			return response;
		}
	}

	/**
	 * 📄 Find a specific document by ID with caching
	 * @param ref - Document ID
	 * @returns Document data or null if not found
	 */
	async findOne(ref: number): Promise<{ doc: Doc | null; message: string }> {
		const startTime = Date.now();
		this.logger.log(`📄 [findOne] Retrieving document: ${ref}`);

		try {
			// Check cache first
			const cacheKey = this.getCacheKey(ref);
			const cachedDoc = await this.cacheManager.get<{ doc: Doc; message: string }>(cacheKey);

			if (cachedDoc) {
				const duration = Date.now() - startTime;
				this.logger.debug(`📄 [findOne] Cache hit for document ${ref} in ${duration}ms`);
				return cachedDoc;
			}

			this.logger.debug(`📄 [findOne] Cache miss - querying database for document: ${ref}`);

			const doc = await this.docsRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'branch'],
			});

			if (!doc) {
				this.logger.warn(`⚠️ [findOne] Document not found: ${ref}`);
				const response = {
					message: 'Document not found',
					doc: null,
				};
				return response;
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Document retrieved successfully',
				doc: doc,
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [findOne] Document retrieved successfully in ${duration}ms: ${doc.title} (ID: ${ref})`);

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [findOne] Failed to retrieve document after ${duration}ms: ${error.message}`, error.stack);
			
			const response = {
				message: `Failed to retrieve document: ${error.message}`,
				doc: null,
			};

			return response;
		}
	}

	/**
	 * 👤 Retrieve documents by user ID with caching
	 * @param ref - User ID
	 * @returns Array of user's documents
	 */
	public async docsByUser(ref: number): Promise<{ message: string; docs: Doc[] }> {
		const startTime = Date.now();
		this.logger.log(`👤 [docsByUser] Retrieving documents for user: ${ref}`);

		try {
			// Check cache first
			const cacheKey = this.getCacheKey(`user_${ref}`);
			const cachedDocs = await this.cacheManager.get<{ message: string; docs: Doc[] }>(cacheKey);

			if (cachedDocs) {
				const duration = Date.now() - startTime;
				this.logger.debug(`👤 [docsByUser] Cache hit for user ${ref} - ${cachedDocs.docs.length} documents in ${duration}ms`);
				return cachedDocs;
			}

			this.logger.debug(`👤 [docsByUser] Cache miss - querying database for user: ${ref}`);

			const docs = await this.docsRepository.find({
				where: { owner: { uid: ref } },
				relations: ['owner', 'branch'],
				order: { createdAt: 'DESC' }
			});

			if (!docs || docs.length === 0) {
				this.logger.warn(`⚠️ [docsByUser] No documents found for user: ${ref}`);
				const response = {
					message: 'No documents found for user',
					docs: [],
				};
				return response;
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'User documents retrieved successfully',
				docs,
			};

			// Cache the results
			await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [docsByUser] Retrieved ${docs.length} documents for user ${ref} in ${duration}ms`);

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [docsByUser] Failed to retrieve documents for user ${ref} after ${duration}ms: ${error.message}`, error.stack);
			
			const response = {
				message: `Could not get documents by user: ${error?.message}`,
				docs: null,
			};

			return response;
		}
	}

	/**
	 * ✏️ Update document metadata
	 * @param ref - Document ID
	 * @param updateDocDto - Update data
	 * @returns Update confirmation
	 */
	async update(ref: number, updateDocDto: UpdateDocDto): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`✏️ [update] Updating document: ${ref}`);

		try {
			// First check if document exists
			const existingDoc = await this.docsRepository.findOne({ where: { uid: ref } });
			if (!existingDoc) {
				this.logger.warn(`⚠️ [update] Document not found: ${ref}`);
				throw new NotFoundException('Document not found');
			}

			this.logger.debug(`✏️ [update] Found document: ${existingDoc.title}, updating with: ${JSON.stringify(updateDocDto)}`);

			const updateData = { ...updateDocDto, updatedAt: new Date() };
			const result = await this.docsRepository.update(ref, updateData as unknown as DeepPartial<Doc>);

			if (!result.affected || result.affected === 0) {
				throw new Error('Document update failed - no rows affected');
			}

			// Invalidate caches after update
			await this.invalidateDocumentCache(ref);

			// Emit document update event
			this.eventEmitter.emit('docs.document.updated', {
				docId: ref,
				previousTitle: existingDoc.title,
				newTitle: updateDocDto.title || existingDoc.title,
				updatedFields: Object.keys(updateDocDto),
				timestamp: new Date(),
			});

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [update] Document updated successfully in ${duration}ms: ${existingDoc.title} (ID: ${ref})`);

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Document updated successfully',
			};

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [update] Failed to update document after ${duration}ms: ${error.message}`, error.stack);
			
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	/**
	 * 🗑️ Delete document from both storage and database
	 * @param ref - Document ID
	 * @returns Deletion confirmation
	 */
	async deleteFromBucket(ref: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`🗑️ [deleteFromBucket] Deleting document: ${ref}`);

		try {
			const doc = await this.docsRepository.findOne({
				where: { uid: ref },
			});

			if (!doc) {
				this.logger.warn(`⚠️ [deleteFromBucket] Document not found: ${ref}`);
				throw new NotFoundException('Document not found');
			}

			this.logger.debug(`🗑️ [deleteFromBucket] Found document: ${doc.title}, proceeding with deletion`);

			// Delete from storage first
			this.logger.debug(`🗑️ [deleteFromBucket] Deleting from storage: ${ref}`);
			await this.storageService.delete(ref);

			// Then delete from database
			this.logger.debug(`🗑️ [deleteFromBucket] Deleting from database: ${ref}`);
			await this.docsRepository.delete(ref);

			// Invalidate caches after deletion
			await this.invalidateDocumentCache(ref);

			// Emit document deletion event
			this.eventEmitter.emit('docs.document.deleted', {
				docId: ref,
				title: doc.title,
				fileName: doc.url,
				timestamp: new Date(),
			});

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [deleteFromBucket] Document deleted successfully in ${duration}ms: ${doc.title} (ID: ${ref})`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Document deleted successfully',
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [deleteFromBucket] Failed to delete document after ${duration}ms: ${error.message}`, error.stack);
			
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * 📤 Upload multiple files with comprehensive validation and transaction management
	 * @param files - Array of Multer file objects
	 * @param bulkUploadDto - Bulk upload configuration
	 * @param ownerId - File owner user ID
	 * @returns Bulk upload results with detailed status for each file
	 */
	async uploadBulkFiles(
		files: Express.Multer.File[], 
		bulkUploadDto: BulkUploadDocDto, 
		ownerId?: number
	): Promise<BulkUploadDocResponse> {
		const startTime = Date.now();
		this.logger.log(`📤 [uploadBulkFiles] Starting bulk upload of ${files.length} files`);

		const results: BulkFileUploadResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		const errors: string[] = [];
		let totalSize = 0;
		const typeSummary: Record<string, number> = {};

		// Validate total size if specified
		if (bulkUploadDto.maxTotalSize) {
			const requestedTotalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
			if (requestedTotalSize > bulkUploadDto.maxTotalSize) {
				const errorMessage = `Total file size (${requestedTotalSize} bytes) exceeds maximum allowed (${bulkUploadDto.maxTotalSize} bytes)`;
				this.logger.error(`❌ [uploadBulkFiles] ${errorMessage}`);
				
				return {
					totalRequested: files.length,
					totalUploaded: 0,
					totalFailed: files.length,
					successRate: 0,
					results: [],
					message: errorMessage,
					errors: [errorMessage],
					duration: Date.now() - startTime
				};
			}
		}

		// Create a query runner for transaction management if creating document records
		let queryRunner: any = null;
		let useTransaction = bulkUploadDto.createDocumentRecords;
		
		if (useTransaction) {
			queryRunner = this.dataSource.createQueryRunner();
			await queryRunner.connect();
			await queryRunner.startTransaction();
		}

		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const fileType = bulkUploadDto.defaultType;
				
				try {
					this.logger.debug(`📝 [uploadBulkFiles] Processing file ${i + 1}/${files.length}: ${file.originalname} (${file.size} bytes)`);
					
					// Individual file validation
					if (!file || !file.buffer) {
						throw new Error('Invalid file: No file data provided');
					}

					if (file.size <= 0) {
						throw new Error('Invalid file: File is empty');
					}

					// File type validation if enabled
					if (bulkUploadDto.validateFileTypes && fileType && !this.isValidFileType(file.mimetype, fileType)) {
						throw new Error(`Invalid file type: ${file.mimetype} for specified type: ${fileType}`);
					}

					// ENHANCEMENT: Optimize image if it's an image file
					const optimizationResult = await this.optimizeImageIfNeeded(
						file.buffer,
						file.mimetype,
						file.originalname,
					);

					// Log optimization if occurred
					if (optimizationResult.originalSize !== optimizationResult.optimizedSize) {
						const compressionRatio = ((optimizationResult.originalSize - optimizationResult.optimizedSize) / optimizationResult.originalSize * 100).toFixed(1);
						this.logger.debug(`📉 [uploadBulkFiles] File ${i + 1} optimized: ${compressionRatio}% reduction`);
					}

					// Upload file to storage
					const uploadResult = await this.storageService.upload(
						{
							buffer: optimizationResult.buffer,
							mimetype: optimizationResult.mimetype,
							originalname: optimizationResult.originalname,
							size: optimizationResult.optimizedSize,
							metadata: {
								type: fileType,
								uploadedBy: ownerId?.toString(),
								branch: bulkUploadDto.branchId?.toString(),
								bulkUpload: 'true',
								uploadIndex: i.toString(),
								originalSize: optimizationResult.originalSize.toString(),
								optimizedSize: optimizationResult.optimizedSize.toString(),
								wasOptimized: (optimizationResult.originalSize !== optimizationResult.optimizedSize).toString(),
							},
						},
						undefined,
						ownerId,
						bulkUploadDto.branchId
					);

					// Create document record if requested
					if (bulkUploadDto.createDocumentRecords && queryRunner) {
						const docData = {
							title: optimizationResult.originalname,
							url: uploadResult.publicUrl,
							mimeType: optimizationResult.mimetype,
							fileSize: optimizationResult.optimizedSize,
							fileType: fileType || 'document',
							content: `Bulk uploaded file: ${file.originalname}`,
							description: bulkUploadDto.documentMetadata?.description || `Bulk uploaded file: ${file.originalname}`,
							metadata: {
								tags: bulkUploadDto.documentMetadata?.tags || ['bulk-upload'],
								category: bulkUploadDto.documentMetadata?.category || 'upload',
								bulkUpload: true
							},
							owner: ownerId ? { uid: ownerId } : undefined,
							branch: bulkUploadDto.branchId ? { uid: bulkUploadDto.branchId } : undefined
						};

						const doc = queryRunner.manager.create(Doc, docData);
						await queryRunner.manager.save(Doc, doc);
						
						this.logger.debug(`📄 [uploadBulkFiles] Document record created for file: ${file.originalname} (Doc ID: ${doc.uid})`);
					}

					// Track type summary
					const detectedType = fileType || this.detectFileType(optimizationResult.mimetype);
					typeSummary[detectedType] = (typeSummary[detectedType] || 0) + 1;
					totalSize += optimizationResult.optimizedSize;

					results.push({
						success: true,
						index: i,
						fileName: optimizationResult.originalname,
						fileSize: optimizationResult.optimizedSize,
						mimeType: optimizationResult.mimetype,
						url: uploadResult.publicUrl,
						type: detectedType,
						uploadedAt: new Date().toISOString()
					});

					successCount++;
					this.logger.debug(`✅ [uploadBulkFiles] File ${i + 1} uploaded successfully: ${file.originalname}`);
					
				} catch (fileError) {
					const errorMessage = `File "${file?.originalname || 'unknown'}": ${fileError.message}`;
					this.logger.error(`❌ [uploadBulkFiles] ${errorMessage}`, fileError.stack);
					
					results.push({
						success: false,
						error: fileError.message,
						index: i,
						fileName: file?.originalname || 'unknown',
						fileSize: file?.size
					});
					
					errors.push(errorMessage);
					failureCount++;

					// Stop processing if continueOnError is false
					if (!bulkUploadDto.continueOnError) {
						this.logger.warn(`⚠️ [uploadBulkFiles] Stopping bulk upload due to error and continueOnError=false`);
						break;
					}
				}
			}

			// Commit transaction if we have successes and are using transactions
			if (useTransaction && queryRunner) {
				if (successCount > 0) {
					await queryRunner.commitTransaction();
					this.logger.log(`✅ [uploadBulkFiles] Transaction committed - ${successCount} files processed successfully`);
				} else {
					await queryRunner.rollbackTransaction();
					this.logger.warn(`⚠️ [uploadBulkFiles] Transaction rolled back - no files were processed successfully`);
				}
			}

			// Invalidate caches after successful uploads
			if (successCount > 0) {
				await this.invalidateDocumentCache();
			}

			// Emit bulk upload event
			this.eventEmitter.emit('docs.bulk.uploaded', {
				totalRequested: files.length,
				totalUploaded: successCount,
				totalFailed: failureCount,
				totalSize,
				typeSummary,
				ownerId,
				orgId: bulkUploadDto.orgId,
				branchId: bulkUploadDto.branchId,
				timestamp: new Date(),
			});

		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			if (useTransaction && queryRunner) {
				await queryRunner.rollbackTransaction();
			}
			this.logger.error(`❌ [uploadBulkFiles] Transaction error: ${transactionError.message}`, transactionError.stack);
			
			return {
				totalRequested: files.length,
				totalUploaded: 0,
				totalFailed: files.length,
				successRate: 0,
				results: [],
				message: `Bulk upload failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime
			};
		} finally {
			// Release the query runner if we used one
			if (useTransaction && queryRunner) {
				await queryRunner.release();
			}
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / files.length) * 100;

		this.logger.log(`🎉 [uploadBulkFiles] Bulk upload completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%`);

		return {
			totalRequested: files.length,
			totalUploaded: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk upload completed: ${successCount} files uploaded, ${failureCount} failed`
				: 'Bulk upload failed: No files were uploaded',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			totalSize,
			typeSummary
		};
	}

	/**
	 * 🔍 Detect file type from MIME type
	 * @param mimetype - File MIME type
	 * @returns Detected file type category
	 */
	private detectFileType(mimetype: string): string {
		if (mimetype.startsWith('image/')) return 'image';
		if (mimetype.includes('pdf') || mimetype.includes('document') || mimetype.includes('word')) return 'document';
		if (mimetype.includes('spreadsheet') || mimetype.includes('excel')) return 'spreadsheet';
		if (mimetype.startsWith('text/')) return 'text';
		return 'other';
	}
}
