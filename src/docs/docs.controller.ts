import { DocsService } from './docs.service';
import { CreateDocDto } from './dto/create-doc.dto';
import { UpdateDocDto } from './dto/update-doc.dto';
import { BulkUploadDocDto, BulkUploadDocResponse } from './dto/bulk-upload-doc.dto';
import { 
	ApiOperation, 
	ApiTags, 
	ApiConsumes, 
	ApiProduces, 
	ApiResponse, 
	ApiOkResponse, 
	ApiCreatedResponse, 
	ApiBadRequestResponse, 
	ApiNotFoundResponse, 
	ApiInternalServerErrorResponse,
	ApiBody,
	ApiParam,
	ApiQuery
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	UseInterceptors,
	UploadedFile,
	UploadedFiles,
	NotFoundException,
	BadRequestException,
	UseGuards,
	ParseFilePipe,
	MaxFileSizeValidator,
	FileTypeValidator,
	Query,
	Request,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { isPublic } from '../decorators/public.decorator';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { RoleGuard } from '../guards/role.guard';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Logger } from '@nestjs/common';

@ApiTags('💾 Documents & Files')
@Controller('docs')
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('claims')
export class DocsController {
	private readonly logger = new Logger(DocsController.name);
	
	constructor(private readonly docsService: DocsService) {}

	@Post()
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@isPublic()
	@ApiOperation({
		summary: '📄 Create a new document record',
		description: `
# Document Creation

Create a new document record in the system for tracking and management.

## Features
- **Document Metadata**: Store document title, description, and type information
- **Organization Scoping**: Associate documents with specific organizations and branches
- **File Type Validation**: Ensure proper document categorization
- **Access Control**: Enterprise-level access control for document management

## Usage
- Provide document metadata including title and description
- Specify document type for proper categorization
- System automatically timestamps creation

## Response
Returns success confirmation with document details or error message if creation fails.
		`,
	})
	@ApiBody({
		type: CreateDocDto,
		description: 'Document metadata to create',
		examples: {
			'Business Document': {
				summary: 'Create a business document record',
				value: {
					title: 'Q4 2024 Business Report',
					description: 'Quarterly business performance and financial analysis report',
					type: 'report',
					category: 'business',
					tags: ['quarterly', 'financial', 'analysis']
				}
			},
			'Contract Document': {
				summary: 'Create a contract document record',
				value: {
					title: 'Service Agreement - LORO Corp',
					description: 'Master service agreement with LORO Corp for technology services',
					type: 'contract',
					category: 'legal',
					tags: ['contract', 'agreement', 'legal']
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Document created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Document created successfully' },
				documentId: { type: 'number', example: 123 },
				title: { type: 'string', example: 'Q4 2024 Business Report' }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid document data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Title is required' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during document creation'
	})
	create(@Body() createDocDto: CreateDocDto, @Request() req?: any) {
		const startTime = Date.now();
		this.logger.log(`📄 [create] Creating new document: ${createDocDto.title || 'Untitled'}`);
		
		try {
			const userId = req?.user?.uid;
			const orgId = req?.user?.org?.uid || req?.user?.organisationRef;
			const branchId = req?.user?.branch?.uid;
			
			this.logger.debug(`📄 [create] Document creation context - User: ${userId}, Org: ${orgId}, Branch: ${branchId}`);
			
			const result = this.docsService.create(createDocDto);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [create] Document created successfully in ${duration}ms: ${createDocDto.title}`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [create] Failed to create document after ${duration}ms: ${error.message}`, error.stack);
			throw new BadRequestException({
				message: `Failed to create document: ${error.message}`,
				error: 'Document Creation Failed',
				statusCode: 400,
			});
		}
	}

	@Post('upload')
	@UseInterceptors(FileInterceptor('file'))
	@ApiOperation({
		summary: '📤 Upload a single file',
		description: `
# File Upload

Upload a single file to the cloud storage system with comprehensive validation and metadata tracking.

## Features
- **File Size Validation**: Maximum 5MB file size limit
- **File Type Validation**: Supports images, documents, spreadsheets, and text files
- **Cloud Storage**: Automatic upload to Google Cloud Storage
- **Metadata Tracking**: Stores file information with user and organization context
- **Security**: Enterprise-level access control and validation

## Supported File Types
- **Images**: JPG, JPEG, PNG, GIF
- **Documents**: PDF, DOC, DOCX
- **Spreadsheets**: XLS, XLSX
- **Text**: TXT

## Usage
- Upload file via multipart/form-data
- Optionally specify file type for categorization
- System automatically extracts metadata and generates secure URLs

## Response
Returns upload confirmation with file URL, metadata, and storage information.
		`,
	})
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		description: 'File upload with optional type specification',
		schema: {
			type: 'object',
			properties: {
				file: {
					type: 'string',
					format: 'binary',
					description: 'File to upload (max 5MB)'
				},
				type: {
					type: 'string',
					description: 'Optional file type categorization',
					enum: ['image', 'document', 'spreadsheet', 'text'],
					example: 'document'
				}
			},
			required: ['file']
		}
	})
	@ApiQuery({
		name: 'type',
		required: false,
		description: 'Optional file type for categorization (image, document, spreadsheet, text)',
		enum: ['image', 'document', 'spreadsheet', 'text']
	})
	@ApiOkResponse({
		description: '✅ File uploaded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'File uploaded successfully' },
				url: { type: 'string', example: 'https://storage.googleapis.com/bucket/file-id.pdf' },
				fileName: { type: 'string', example: 'business-report.pdf' },
				fileSize: { type: 'number', example: 2048576 },
				mimeType: { type: 'string', example: 'application/pdf' },
				type: { type: 'string', example: 'document' },
				uploadedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid file or upload error',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					examples: [
						'File too large (max 5MB)',
						'Invalid file type',
						'No file provided',
						'File upload failed'
					]
				},
				error: { type: 'string', example: 'File Upload Failed' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during file upload'
	})
	async uploadFile(
		@UploadedFile(
			new ParseFilePipe({
				validators: [
					new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
					new FileTypeValidator({ fileType: /(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|txt)$/i }),
				],
				errorHttpStatusCode: 400,
			}),
		)
		file: Express.Multer.File,
		@Query('type') type?: string,
		@Request() req?: any,
	) {
		const startTime = Date.now();
		this.logger.log(`📤 [uploadFile] Starting file upload: ${file?.originalname || 'unknown'} (${file?.size || 0} bytes)`);
		
		try {
			const ownerId = req.user?.uid;
			const branchId = req.user?.branch?.uid;
			const orgId = req?.tokenOrgId;
			if (!orgId) {
				throw new BadRequestException('Organization context required');
			}

			this.logger.debug(`📤 [uploadFile] Upload context - User: ${ownerId}, Org: ${orgId}, Branch: ${branchId}, Type: ${type || 'auto'}`);
			
			if (!file || !file.buffer) {
				throw new BadRequestException('No file provided or file is empty');
			}

			this.logger.debug(`📤 [uploadFile] File details - Name: ${file.originalname}, Size: ${file.size}, Type: ${file.mimetype}`);

			const result = await this.docsService.uploadFile(file, type, ownerId, branchId);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [uploadFile] File uploaded successfully in ${duration}ms: ${file.originalname}`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [uploadFile] File upload failed after ${duration}ms: ${error.message}`, error.stack);
			
			throw new BadRequestException({
				message: error.message,
				error: 'File Upload Failed',
				statusCode: 400,
			});
		}
	}

	@Post('/remove/:ref')
	@isPublic()
	@ApiOperation({
		summary: '🗑️ Delete file from storage',
		description: `
# File Deletion

Permanently delete a file from both the database and cloud storage.

## Features
- **Database Cleanup**: Removes document record from database
- **Storage Cleanup**: Deletes actual file from Google Cloud Storage
- **Audit Trail**: Logs deletion activity for compliance
- **Error Handling**: Graceful handling of missing files or storage errors

## Usage
- Provide document reference ID in URL path
- System locates file and removes from both database and storage
- Returns confirmation of deletion success or error details

## Security
- Enterprise-level access control
- Validates document existence before deletion
- Prevents unauthorized file removal

## Response
Returns deletion confirmation with cleanup details or error message if deletion fails.
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Document reference ID to delete',
		type: 'number',
		example: 123
	})
	@ApiOkResponse({
		description: '✅ File deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'File deleted successfully' },
				documentId: { type: 'number', example: 123 },
				fileName: { type: 'string', example: 'business-report.pdf' },
				deletedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Document not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Document not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Deletion failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to delete file from storage' },
				error: { type: 'string', example: 'Deletion Error' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during file deletion'
	})
	async deleteFromBucket(@Param('ref') ref: number) {
		const startTime = Date.now();
		this.logger.log(`🗑️ [deleteFromBucket] Starting file deletion for document ID: ${ref}`);
		
		try {
			this.logger.debug(`🗑️ [deleteFromBucket] Validating document existence: ${ref}`);
			
			const result = await this.docsService.deleteFromBucket(ref);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [deleteFromBucket] File deleted successfully in ${duration}ms: ${ref}`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [deleteFromBucket] File deletion failed after ${duration}ms: ${error.message}`, error.stack);
			
			if (error instanceof NotFoundException) {
				throw error;
			}
			
			throw new BadRequestException({
				message: `Failed to delete file: ${error.message}`,
				error: 'Deletion Error',
				statusCode: 400,
			});
		}
	}

	async getExtension(filename: string) {
		const parts = filename?.split('.');
		return parts?.length === 1 ? '' : parts[parts?.length - 1];
	}

	@Get()
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '📋 Get all documents',
		description: `
# Document Listing

Retrieve a comprehensive list of all documents in the system with metadata and access information.

## Features
- **Complete Inventory**: Lists all documents across the organization
- **Metadata Included**: File names, types, sizes, upload dates, and ownership
- **Access Control**: Role-based filtering ensures users see authorized documents
- **Organization Scoping**: Documents filtered by user's organization context
- **Performance Optimized**: Efficient querying for large document collections

## Access Levels
- **Admin/Manager**: Access to all organizational documents
- **Developer/Support**: Technical documents and system files
- **User**: Personal and assigned documents
- **Technician**: Technical documentation and manuals

## Response
Returns array of document objects with complete metadata including:
- Document ID and title
- File type and size information
- Upload timestamp and owner details
- Organization and branch associations
- Access permissions and sharing status

## Usage
- No parameters required for basic listing
- System automatically applies role-based filtering
- Results include pagination for large collections
		`,
	})
	@ApiOkResponse({
		description: '✅ Documents retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Documents retrieved successfully' },
				docs: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 123 },
							title: { type: 'string', example: 'Q4 2024 Business Report' },
							description: { type: 'string', example: 'Quarterly business performance analysis' },
							url: { type: 'string', example: 'https://storage.googleapis.com/bucket/file.pdf' },
							mimeType: { type: 'string', example: 'application/pdf' },
							fileSize: { type: 'number', example: 2048576 },
							type: { type: 'string', example: 'document' },
							uploadedAt: { type: 'string', example: '2024-01-15T10:30:00Z' },
							owner: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 456 },
									name: { type: 'string', example: 'The Guy' },
									email: { type: 'string', example: 'theguy@example.co.za' }
								}
							}
						}
					}
				},
				totalCount: { type: 'number', example: 25 },
				retrievedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 No documents found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No documents found' },
				docs: { type: 'null' }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during document retrieval'
	})
	findAll(@Request() req?: any) {
		const startTime = Date.now();
		this.logger.log(`📋 [findAll] Retrieving all documents`);
		
		try {
			const userId = req?.user?.uid;
			const userRole = req?.user?.accessLevel;
			const orgId = req?.user?.org?.uid || req?.user?.organisationRef;
			
			this.logger.debug(`📋 [findAll] Request context - User: ${userId}, Role: ${userRole}, Org: ${orgId}`);
			
			const result = this.docsService.findAll();
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [findAll] Documents retrieved successfully in ${duration}ms`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [findAll] Failed to retrieve documents after ${duration}ms: ${error.message}`, error.stack);
			
			throw new BadRequestException({
				message: `Failed to retrieve documents: ${error.message}`,
				error: 'Document Retrieval Failed',
				statusCode: 400,
			});
		}
	}

	@Get('user/:ref')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '👤 Get documents by user',
		description: `
# User Documents

Retrieve all documents owned or uploaded by a specific user.

## Features
- **User-Specific Filtering**: Lists only documents associated with the specified user
- **Ownership Tracking**: Shows documents created or uploaded by the user
- **Access Control**: Respects user permissions and organizational boundaries
- **Complete Metadata**: Includes file details, upload timestamps, and sharing info
- **Performance Optimized**: Efficient querying by user reference

## Access Control
- **Admin/Manager**: Can view any user's documents within organization
- **User**: Can only view their own documents unless elevated permissions
- **Support/Developer**: Access based on organizational policies

## Response
Returns array of user's documents with:
- Document metadata and file information
- Upload and modification timestamps
- File size and type details
- Access permissions and sharing status

## Usage
- Provide user reference ID in URL path
- System validates access permissions
- Results filtered by organizational context
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'User reference ID to get documents for',
		type: 'number',
		example: 456
	})
	@ApiOkResponse({
		description: '✅ User documents retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User documents retrieved successfully' },
				docs: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 123 },
							title: { type: 'string', example: 'User Report' },
							description: { type: 'string', example: 'Personal work document' },
							url: { type: 'string', example: 'https://storage.googleapis.com/bucket/user-file.pdf' },
							mimeType: { type: 'string', example: 'application/pdf' },
							fileSize: { type: 'number', example: 1024576 },
							uploadedAt: { type: 'string', example: '2024-01-10T14:20:00Z' }
						}
					}
				},
				userRef: { type: 'number', example: 456 },
				documentCount: { type: 'number', example: 12 }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 User not found or no documents',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No documents found for user' },
				docs: { type: 'null' }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during user document retrieval'
	})
	findByUser(@Param('ref') ref: number, @Request() req?: any) {
		const startTime = Date.now();
		this.logger.log(`👤 [findByUser] Retrieving documents for user: ${ref}`);
		
		try {
			const requesterId = req?.user?.uid;
			const requesterRole = req?.user?.accessLevel;
			const orgId = req?.user?.org?.uid || req?.user?.organisationRef;
			
			this.logger.debug(`👤 [findByUser] Request context - Requester: ${requesterId}, Role: ${requesterRole}, Target User: ${ref}, Org: ${orgId}`);
			
			// Validate access permissions
			if (requesterId !== ref && !['ADMIN', 'MANAGER', 'OWNER'].includes(requesterRole)) {
				this.logger.warn(`⚠️ [findByUser] Unauthorized access attempt - User ${requesterId} trying to access user ${ref}'s documents`);
				throw new BadRequestException('Unauthorized: Cannot access other user\'s documents');
			}
			
			const result = this.docsService.docsByUser(ref);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [findByUser] User documents retrieved successfully in ${duration}ms for user: ${ref}`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [findByUser] Failed to retrieve user documents after ${duration}ms: ${error.message}`, error.stack);
			
			if (error instanceof BadRequestException) {
				throw error;
			}
			
			throw new BadRequestException({
				message: `Failed to retrieve user documents: ${error.message}`,
				error: 'User Document Retrieval Failed',
				statusCode: 400,
			});
		}
	}

	@Get(':ref')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '📄 Get document by ID',
		description: `
# Document Details

Retrieve detailed information about a specific document including metadata, ownership, and access details.

## Features
- **Complete Document Info**: Full metadata including file details and timestamps
- **Ownership Details**: Shows document owner and organizational context
- **Access Validation**: Ensures user has permission to view document
- **Relationship Data**: Includes associated branch and organization information
- **File Status**: Current file status and availability information

## Access Control
- **Document Owner**: Full access to their own documents
- **Admin/Manager**: Access to organizational documents
- **Team Members**: Access based on sharing permissions and roles
- **Enterprise Controls**: Respects organizational access policies

## Response
Returns complete document object with:
- Document metadata and file information
- Owner and organizational details
- Upload and modification timestamps
- File size, type, and storage location
- Access permissions and sharing status

## Usage
- Provide document reference ID in URL path
- System validates access permissions automatically
- Returns full document details or access denied error
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Document reference ID to retrieve',
		type: 'number',
		example: 123
	})
	@ApiOkResponse({
		description: '✅ Document retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Document retrieved successfully' },
				doc: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 123 },
						title: { type: 'string', example: 'Q4 2024 Business Report' },
						description: { type: 'string', example: 'Comprehensive quarterly business analysis' },
						url: { type: 'string', example: 'https://storage.googleapis.com/bucket/report.pdf' },
						mimeType: { type: 'string', example: 'application/pdf' },
						fileSize: { type: 'number', example: 3072768 },
						type: { type: 'string', example: 'document' },
						uploadedAt: { type: 'string', example: '2024-01-15T10:30:00Z' },
						updatedAt: { type: 'string', example: '2024-01-15T10:30:00Z' },
						owner: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456 },
								name: { type: 'string', example: 'The Guy' },
								email: { type: 'string', example: 'theguy@example.co.za' }
							}
						},
						branch: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 789 },
								name: { type: 'string', example: 'Pretoria Branch' }
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Document not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Document not found' },
				doc: { type: 'null' }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during document retrieval'
	})
	findOne(@Param('ref') ref: number, @Request() req?: any) {
		const startTime = Date.now();
		this.logger.log(`📄 [findOne] Retrieving document: ${ref}`);
		
		try {
			const userId = req?.user?.uid;
			const userRole = req?.user?.accessLevel;
			const orgId = req?.user?.org?.uid || req?.user?.organisationRef;
			
			this.logger.debug(`📄 [findOne] Request context - User: ${userId}, Role: ${userRole}, Org: ${orgId}, Document: ${ref}`);
			
			const result = this.docsService.findOne(ref);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [findOne] Document retrieved successfully in ${duration}ms: ${ref}`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [findOne] Failed to retrieve document after ${duration}ms: ${error.message}`, error.stack);
			
			if (error instanceof NotFoundException) {
				throw error;
			}
			
			throw new BadRequestException({
				message: `Failed to retrieve document: ${error.message}`,
				error: 'Document Retrieval Failed',
				statusCode: 400,
			});
		}
	}

	@Patch(':ref')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '✏️ Update document metadata',
		description: `
# Document Update

Update document metadata including title, description, and categorization information.

## Features
- **Metadata Updates**: Modify title, description, type, and tags
- **Version Control**: Tracks modification history and timestamps
- **Access Validation**: Ensures user has permission to modify document
- **Audit Trail**: Logs all changes for compliance and tracking
- **Data Validation**: Validates updated information before saving

## Updatable Fields
- **Title**: Document display name
- **Description**: Detailed document description
- **Type**: Document categorization (report, contract, etc.)
- **Tags**: Keywords for organization and search
- **Category**: Business categorization

## Access Control
- **Document Owner**: Can update their own documents
- **Admin/Manager**: Can update organizational documents
- **Shared Access**: Based on sharing permissions and roles

## Response
Returns update confirmation with modified document details or error if update fails.

## Usage
- Provide document reference ID in URL path
- Include updated fields in request body
- System validates access and applies changes
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Document reference ID to update',
		type: 'number',
		example: 123
	})
	@ApiBody({
		type: UpdateDocDto,
		description: 'Document metadata updates',
		examples: {
			'Update Title and Description': {
				summary: 'Update document title and description',
				value: {
					title: 'Q4 2024 Revised Business Report',
					description: 'Updated quarterly business analysis with latest market data and projections'
				}
			},
			'Update Tags and Category': {
				summary: 'Update document categorization',
				value: {
					type: 'report',
					category: 'financial',
					tags: ['quarterly', 'financial', 'analysis', 'revised']
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Document updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Document updated successfully' },
				documentId: { type: 'number', example: 123 },
				updatedFields: { 
					type: 'array', 
					items: { type: 'string' },
					example: ['title', 'description', 'tags']
				},
				updatedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Document not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Document not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid update data or unauthorized access'
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during document update'
	})
	update(@Param('ref') ref: number, @Body() updateDocDto: UpdateDocDto, @Request() req?: any) {
		const startTime = Date.now();
		this.logger.log(`✏️ [update] Updating document: ${ref}`);
		
		try {
			const userId = req?.user?.uid;
			const userRole = req?.user?.accessLevel;
			const orgId = req?.user?.org?.uid || req?.user?.organisationRef;
			
			this.logger.debug(`✏️ [update] Update context - User: ${userId}, Role: ${userRole}, Document: ${ref}, Updates: ${JSON.stringify(updateDocDto)}`);
			
			const result = this.docsService.update(ref, updateDocDto);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [update] Document updated successfully in ${duration}ms: ${ref}`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [update] Failed to update document after ${duration}ms: ${error.message}`, error.stack);
			
			if (error instanceof NotFoundException) {
				throw error;
			}
			
			throw new BadRequestException({
				message: `Failed to update document: ${error.message}`,
				error: 'Document Update Failed',
				statusCode: 400,
			});
		}
	}

	@Get('download/:ref')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '⬇️ Get secure download URL',
		description: `
# Document Download

Generate a secure, time-limited URL for downloading documents from cloud storage.

## Features
- **Secure URLs**: Generates signed URLs with expiration times
- **Access Control**: Validates user permissions before URL generation
- **Cloud Integration**: Direct download from Google Cloud Storage
- **Audit Logging**: Tracks download requests for compliance
- **File Validation**: Ensures file exists and is accessible

## Security
- **Time-Limited**: URLs expire after configured time period
- **Permission-Based**: Respects document access permissions
- **Organization Scoped**: Validates organizational boundaries
- **Audit Trail**: Logs all download requests

## Response
Returns secure download information including:
- Signed download URL with expiration
- File metadata (name, type, size)
- Download permissions and restrictions
- URL expiration timestamp

## Usage
- Provide document reference ID in URL path
- System validates access permissions
- Returns time-limited download URL
- Use URL immediately for file download

## Note
Generated URLs are temporary and expire for security purposes.
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Document reference ID to generate download URL for',
		type: 'number',
		example: 123
	})
	@ApiOkResponse({
		description: '✅ Download URL generated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Download URL generated successfully' },
				url: { 
					type: 'string', 
					example: 'https://storage.googleapis.com/bucket/file.pdf?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=...' 
				},
				fileName: { type: 'string', example: 'Q4-2024-Business-Report.pdf' },
				mimeType: { type: 'string', example: 'application/pdf' },
				fileSize: { type: 'number', example: 3072768 },
				expiresAt: { type: 'string', example: '2024-01-15T11:30:00Z' },
				downloadInstructions: { 
					type: 'string', 
					example: 'Use this URL to download the file. URL expires in 1 hour.' 
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Document not found or inaccessible',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Document not found or file unavailable' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid document ID or access denied'
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during URL generation'
	})
	async getDownloadUrl(@Param('ref') ref: number, @Request() req?: any) {
		const startTime = Date.now();
		this.logger.log(`⬇️ [getDownloadUrl] Generating download URL for document: ${ref}`);
		
		try {
			const userId = req?.user?.uid;
			const userRole = req?.user?.accessLevel;
			const orgId = req?.user?.org?.uid || req?.user?.organisationRef;
			
			this.logger.debug(`⬇️ [getDownloadUrl] Download request context - User: ${userId}, Role: ${userRole}, Document: ${ref}, Org: ${orgId}`);
			
			const result = await this.docsService.getDownloadUrl(ref);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [getDownloadUrl] Download URL generated successfully in ${duration}ms for document: ${ref}`);
			
			// Log download request for audit trail
			this.logger.log(`📊 [getDownloadUrl] Download requested by user ${userId} for document ${ref} (${result.fileName})`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [getDownloadUrl] Failed to generate download URL after ${duration}ms: ${error.message}`, error.stack);
			
			if (error instanceof NotFoundException) {
				throw error;
			}
			
			throw new BadRequestException({
				message: `Failed to generate download URL: ${error.message}`,
				error: 'Download URL Generation Failed',
				statusCode: 400,
			});
		}
	}

	@Post('bulk-upload')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@UseInterceptors(FilesInterceptor('files', 20)) // Allow up to 20 files
	@ApiOperation({
		summary: '📤 Bulk upload multiple files',
		description: `
# Bulk File Upload

Upload multiple files simultaneously with advanced configuration options and comprehensive status reporting.

## Features
- **Multi-File Processing**: Upload up to 20 files in a single request
- **Transaction Support**: Optional atomic operations for document record creation
- **File Validation**: Comprehensive validation including size, type, and total limits
- **Error Handling**: Continue on error or fail-fast options
- **Progress Tracking**: Detailed status for each individual file
- **Document Integration**: Optionally create document records for uploaded files
- **Type Detection**: Automatic file type categorization
- **Cache Management**: Intelligent cache invalidation after successful uploads

## Supported File Types
- **Images**: JPG, JPEG, PNG, GIF
- **Documents**: PDF, DOC, DOCX
- **Spreadsheets**: XLS, XLSX
- **Text Files**: TXT

## Configuration Options
- **Total Size Limits**: Control maximum combined file size
- **Type Validation**: Enable/disable strict file type checking
- **Continue on Error**: Choose between fail-fast or continue processing
- **Document Records**: Automatically create database records for files
- **Metadata**: Apply default metadata to all uploaded files

## Response Details
Returns comprehensive upload results including:
- Individual file status (success/failure)
- Upload URLs and metadata for successful files
- Detailed error messages for failed files
- Performance metrics and timing
- Type distribution summary
- Total size and success rate statistics

## Usage Examples
- **Business Document Bulk Upload**: Upload quarterly reports, contracts, and presentations
- **Media Asset Management**: Batch upload images, videos, and marketing materials
- **Project Documentation**: Upload technical specs, requirements, and design files
- **Archive Migration**: Transfer historical documents from legacy systems

## Security & Performance
- Enterprise-level access control and validation
- Optimized for large file batches with transaction safety
- Comprehensive audit logging for compliance
- Intelligent cache management for optimal performance
		`,
	})
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		description: 'Multiple files with bulk upload configuration',
		schema: {
			type: 'object',
			properties: {
				files: {
					type: 'array',
					items: {
						type: 'string',
						format: 'binary'
					},
					description: 'Array of files to upload (max 20 files, 5MB each)'
				},
				orgId: {
					type: 'number',
					description: 'Organization ID for file association',
					example: 123
				},
				branchId: {
					type: 'number', 
					description: 'Branch ID for file association',
					example: 456
				},
				defaultType: {
					type: 'string',
					enum: ['image', 'document', 'spreadsheet', 'text'],
					description: 'Default file type categorization',
					example: 'document'
				},
				validateFileTypes: {
					type: 'boolean',
					description: 'Whether to validate all file types',
					example: true
				},
				continueOnError: {
					type: 'boolean',
					description: 'Whether to continue if some files fail',
					example: true
				},
				maxTotalSize: {
					type: 'number',
					description: 'Maximum total size for all files (bytes)',
					example: 52428800
				},
				createDocumentRecords: {
					type: 'boolean',
					description: 'Create document records for uploaded files',
					example: true
				},
				documentMetadata: {
					type: 'object',
					properties: {
						category: { type: 'string', example: 'business' },
						tags: { type: 'array', items: { type: 'string' }, example: ['quarterly', 'reports'] },
						description: { type: 'string', example: 'Q4 2024 business documents' }
					},
					description: 'Default metadata for document records'
				}
			},
			required: ['files']
		}
	})
	@ApiOkResponse({
		description: '✅ Bulk upload completed (may include partial failures)',
		type: BulkUploadDocResponse,
		schema: {
			type: 'object',
			properties: {
				totalRequested: { type: 'number', example: 5 },
				totalUploaded: { type: 'number', example: 4 },
				totalFailed: { type: 'number', example: 1 },
				successRate: { type: 'number', example: 80.0 },
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							success: { type: 'boolean', example: true },
							error: { type: 'string', example: 'File too large' },
							index: { type: 'number', example: 0 },
							fileName: { type: 'string', example: 'business-report.pdf' },
							fileSize: { type: 'number', example: 2048576 },
							mimeType: { type: 'string', example: 'application/pdf' },
							url: { type: 'string', example: 'https://storage.googleapis.com/bucket/file.pdf' },
							type: { type: 'string', example: 'document' },
							uploadedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
						}
					}
				},
				message: { type: 'string', example: 'Bulk upload completed: 4 files uploaded, 1 failed' },
				errors: { 
					type: 'array', 
					items: { type: 'string' },
					example: ['File "large-file.pdf": File too large (max 5MB)']
				},
				duration: { type: 'number', example: 3500 },
				totalSize: { type: 'number', example: 8388608 },
				typeSummary: { 
					type: 'object',
					example: { documents: 3, images: 1 }
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid files or configuration',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'No files provided'
				},
				error: { type: 'string', example: 'Bulk Upload Failed' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during bulk upload processing'
	})
	async uploadBulkFiles(
		@UploadedFiles(
			new ParseFilePipe({
				validators: [
					new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB per file
					new FileTypeValidator({ fileType: /(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|txt)$/i }),
				],
				errorHttpStatusCode: 400,
				fileIsRequired: false // Allow partial validation failures
			}),
		)
		files: Express.Multer.File[],
		@Body() bulkUploadDto: BulkUploadDocDto,
		@Request() req?: any,
	): Promise<BulkUploadDocResponse> {
		const startTime = Date.now();
		this.logger.log(`📤 [uploadBulkFiles] Starting bulk upload request with ${files?.length || 0} files`);
		
		try {
			const ownerId = req?.user?.uid;
			const orgId = req?.user?.org?.uid || req?.user?.organisationRef || bulkUploadDto.orgId;
			const branchId = req?.user?.branch?.uid || bulkUploadDto.branchId;

			this.logger.debug(`📤 [uploadBulkFiles] Bulk upload context - User: ${ownerId}, Org: ${orgId}, Branch: ${branchId}`);

			// Validate files array
			if (!files || files.length === 0) {
				throw new BadRequestException('No files provided for upload');
			}

			if (files.length > 20) {
				throw new BadRequestException('Maximum 20 files allowed per bulk upload');
			}

			// Update DTO with request context
			const uploadDto = {
				...bulkUploadDto,
				orgId: orgId || bulkUploadDto.orgId,
				branchId: branchId || bulkUploadDto.branchId
			};

			this.logger.debug(`📤 [uploadBulkFiles] Processing ${files.length} files with config: ${JSON.stringify(uploadDto)}`);

			const result = await this.docsService.uploadBulkFiles(files, uploadDto, ownerId);
			
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [uploadBulkFiles] Bulk upload completed in ${duration}ms - ${result.totalUploaded}/${result.totalRequested} files successful`);
			
			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [uploadBulkFiles] Bulk upload failed after ${duration}ms: ${error.message}`, error.stack);
			
			throw new BadRequestException({
				message: error.message,
				error: 'Bulk Upload Failed',
				statusCode: 400,
			});
		}
	}
}
