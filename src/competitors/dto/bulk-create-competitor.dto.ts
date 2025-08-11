import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsNumber, ValidateNested, ArrayMinSize, ArrayMaxSize, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateCompetitorDto } from './create-competitor.dto';

/**
 * DTO for individual competitor creation result in bulk operations
 */
export class BulkCompetitorResult {
	@ApiProperty({
		description: 'Created competitor object or null if creation failed',
		example: {
			uid: 123,
			name: 'Tech Competitor SA',
			website: 'https://techcompetitor.co.za',
			contactEmail: 'info@techcompetitor.co.za',
			industry: 'Technology',
			threatLevel: 4
		},
		nullable: true
	})
	competitor: any | null;

	@ApiProperty({
		description: 'Whether the competitor creation was successful',
		example: true
	})
	success: boolean;

	@ApiProperty({
		description: 'Error message if creation failed',
		example: 'Website URL already exists',
		required: false
	})
	error?: string;

	@ApiProperty({
		description: 'Index of the competitor in the original request array',
		example: 0
	})
	index: number;

	@ApiProperty({
		description: 'Name of the competitor being created',
		example: 'Tech Competitor SA'
	})
	name: string;

	@ApiProperty({
		description: 'Website of the competitor being created',
		example: 'https://techcompetitor.co.za',
		required: false
	})
	website?: string;
}

/**
 * DTO for bulk competitor creation request
 */
export class BulkCreateCompetitorDto {
	@IsArray()
	@IsNotEmpty()
	@ArrayMinSize(1, { message: 'At least one competitor must be provided' })
	@ArrayMaxSize(50, { message: 'Maximum 50 competitors can be created at once' })
	@ValidateNested({ each: true })
	@Type(() => CreateCompetitorDto)
	@ApiProperty({
		description: 'Array of competitors to create (max 50)',
		type: [CreateCompetitorDto],
		minItems: 1,
		maxItems: 50,
		example: [
			{
				name: 'Tech Innovations SA',
				description: 'Leading technology solutions provider in South Africa',
				website: 'https://techinnovations.co.za',
				contactEmail: 'info@techinnovations.co.za',
				contactPhone: '+27 11 555 1234',
				address: {
					street: '789 Innovation Boulevard',
					suburb: 'Sandton',
					city: 'Johannesburg',
					state: 'Gauteng',
					country: 'South Africa',
					postalCode: '2196'
				},
				industry: 'Technology',
				threatLevel: 4,
				competitiveAdvantage: 3,
				estimatedAnnualRevenue: 50000000,
				estimatedEmployeeCount: 300,
				keyProducts: ['CRM Software', 'Business Intelligence', 'Cloud Solutions'],
				keyStrengths: ['Strong local presence', 'Competitive pricing', 'Good customer support'],
				keyWeaknesses: ['Limited international reach', 'Smaller R&D budget'],
				competitorType: 'DIRECT',
				isDirect: true
			},
			{
				name: 'Digital Solutions Africa',
				description: 'African digital transformation specialists',
				website: 'https://digitalsolutions.africa',
				contactEmail: 'contact@digitalsolutions.africa',
				contactPhone: '+27 21 888 9999',
				address: {
					street: '456 Tech Park Drive',
					suburb: 'Century City',
					city: 'Cape Town',
					state: 'Western Cape',
					country: 'South Africa',
					postalCode: '7441'
				},
				industry: 'Digital Services',
				threatLevel: 3,
				competitiveAdvantage: 4,
				estimatedAnnualRevenue: 25000000,
				estimatedEmployeeCount: 150,
				keyProducts: ['Mobile Apps', 'Web Development', 'Digital Marketing'],
				keyStrengths: ['Innovative solutions', 'Fast delivery', 'Creative team'],
				keyWeaknesses: ['Higher pricing', 'Limited enterprise experience'],
				competitorType: 'INDIRECT',
				isDirect: false
			}
		]
	})
	competitors: CreateCompetitorDto[];

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Organization ID to associate competitors with',
		example: 1,
		required: false
	})
	orgId?: number;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Branch ID to associate competitors with',
		example: 1,
		required: false
	})
	branchId?: number;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to validate competitor websites and social media links',
		example: true,
		default: false,
		required: false
	})
	validateUrls?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to auto-calculate threat levels based on market data',
		example: false,
		default: false,
		required: false
	})
	autoCalculateThreat?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to set up geofencing for competitor locations',
		example: true,
		default: false,
		required: false
	})
	enableGeofencing?: boolean;
}

/**
 * DTO for bulk competitor creation response
 */
export class BulkCreateCompetitorResponse {
	@ApiProperty({
		description: 'Total number of competitors requested for creation',
		example: 10
	})
	totalRequested: number;

	@ApiProperty({
		description: 'Total number of competitors successfully created',
		example: 8
	})
	totalCreated: number;

	@ApiProperty({
		description: 'Total number of competitors that failed to be created',
		example: 2
	})
	totalFailed: number;

	@ApiProperty({
		description: 'Success rate as a percentage',
		example: 80.0
	})
	successRate: number;

	@ApiProperty({
		description: 'Detailed results for each competitor creation attempt',
		type: [BulkCompetitorResult]
	})
	results: BulkCompetitorResult[];

	@ApiProperty({
		description: 'Summary message of the bulk operation',
		example: 'Bulk creation completed: 8 competitors created, 2 failed'
	})
	message: string;

	@ApiProperty({
		description: 'Array of error messages for failed creations',
		type: [String],
		required: false,
		example: ['Competitor 3 (invalid-url): Invalid website URL', 'Competitor 7 (duplicate): Name already exists']
	})
	errors?: string[];

	@ApiProperty({
		description: 'Duration of the bulk operation in milliseconds',
		example: 1250
	})
	duration: number;

	@ApiProperty({
		description: 'Array of successfully created competitor IDs',
		type: [Number],
		required: false,
		example: [101, 102, 103, 104, 105, 106, 107, 108]
	})
	createdCompetitorIds?: number[];

	@ApiProperty({
		description: 'Number of URLs validated',
		example: 8,
		required: false
	})
	urlsValidated?: number;

	@ApiProperty({
		description: 'Number of competitors with auto-calculated threat levels',
		example: 5,
		required: false
	})
	threatLevelsCalculated?: number;

	@ApiProperty({
		description: 'Number of competitors with geofencing enabled',
		example: 6,
		required: false
	})
	geofencesEnabled?: number;
}
