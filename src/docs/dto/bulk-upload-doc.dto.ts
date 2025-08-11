import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsNumber, IsBoolean, ValidateNested, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkFileUploadResult {
	@ApiProperty({
		description: 'Upload success status',
		example: true
	})
	success: boolean;

	@ApiProperty({
		description: 'Error message if upload failed',
		example: 'File too large',
		required: false
	})
	error?: string;

	@ApiProperty({
		description: 'Index in original files array',
		example: 0
	})
	index: number;

	@ApiProperty({
		description: 'Original filename',
		example: 'business-report.pdf'
	})
	fileName: string;

	@ApiProperty({
		description: 'File size in bytes',
		example: 2048576,
		required: false
	})
	fileSize?: number;

	@ApiProperty({
		description: 'File MIME type',
		example: 'application/pdf',
		required: false
	})
	mimeType?: string;

	@ApiProperty({
		description: 'Uploaded file URL',
		example: 'https://storage.googleapis.com/bucket/file-id.pdf',
		required: false
	})
	url?: string;

	@ApiProperty({
		description: 'File type categorization',
		example: 'document',
		required: false
	})
	type?: string;

	@ApiProperty({
		description: 'Upload timestamp',
		example: '2024-01-15T10:30:00Z',
		required: false
	})
	uploadedAt?: string;
}

export class BulkUploadDocResponse {
	@ApiProperty({
		description: 'Total number of files requested for upload',
		example: 5
	})
	totalRequested: number;

	@ApiProperty({
		description: 'Number of files uploaded successfully',
		example: 4
	})
	totalUploaded: number;

	@ApiProperty({
		description: 'Number of files that failed to upload',
		example: 1
	})
	totalFailed: number;

	@ApiProperty({
		description: 'Success rate percentage',
		example: 80.0
	})
	successRate: number;

	@ApiProperty({
		description: 'Upload results for each file',
		type: [BulkFileUploadResult]
	})
	results: BulkFileUploadResult[];

	@ApiProperty({
		description: 'Overall operation message',
		example: 'Bulk upload completed: 4 files uploaded, 1 failed'
	})
	message: string;

	@ApiProperty({
		description: 'Array of error messages for failed uploads',
		type: [String],
		required: false
	})
	errors?: string[];

	@ApiProperty({
		description: 'Operation duration in milliseconds',
		example: 2500
	})
	duration: number;

	@ApiProperty({
		description: 'Total size of all uploaded files in bytes',
		example: 8388608,
		required: false
	})
	totalSize?: number;

	@ApiProperty({
		description: 'Summary of file types uploaded',
		example: { documents: 3, images: 1 },
		required: false
	})
	typeSummary?: Record<string, number>;
}

export class BulkUploadDocDto {
	@ApiProperty({
		description: 'Organization ID for file association',
		example: 123,
		required: false
	})
	@IsOptional()
	@IsNumber()
	orgId?: number;

	@ApiProperty({
		description: 'Branch ID for file association',
		example: 456,
		required: false
	})
	@IsOptional()
	@IsNumber()
	branchId?: number;

	@ApiProperty({
		description: 'Default file type for categorization if not specified per file',
		enum: ['image', 'document', 'spreadsheet', 'text'],
		example: 'document',
		required: false
	})
	@IsOptional()
	@IsEnum(['image', 'document', 'spreadsheet', 'text'])
	defaultType?: string;

	@ApiProperty({
		description: 'Whether to validate all file types before processing',
		example: true,
		default: true
	})
	@IsOptional()
	@IsBoolean()
	validateFileTypes?: boolean = true;

	@ApiProperty({
		description: 'Whether to continue processing if some files fail',
		example: true,
		default: true
	})
	@IsOptional()
	@IsBoolean()
	continueOnError?: boolean = true;

	@ApiProperty({
		description: 'Maximum total size for all files combined (in bytes)',
		example: 52428800, // 50MB
		required: false
	})
	@IsOptional()
	@IsNumber()
	maxTotalSize?: number;

	@ApiProperty({
		description: 'Create document records for uploaded files',
		example: true,
		default: false
	})
	@IsOptional()
	@IsBoolean()
	createDocumentRecords?: boolean = false;

	@ApiProperty({
		description: 'Default document metadata for created records',
		required: false,
		example: {
			category: 'business',
			tags: ['upload', 'bulk']
		}
	})
	@IsOptional()
	documentMetadata?: {
		category?: string;
		tags?: string[];
		description?: string;
	};
}
