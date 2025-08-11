import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsNumber, ValidateNested, ArrayMinSize, ArrayMaxSize, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateClientDto } from './create-client.dto';

/**
 * DTO for individual client creation result in bulk operations
 */
export class BulkClientResult {
	@ApiProperty({
		description: 'Created client object or null if creation failed',
		example: {
			uid: 123,
			name: 'LORO Corp',
			contactPerson: 'The Guy',
			email: 'theguy@example.co.za',
			phone: '+27 11 123 4567',
			category: 'enterprise'
		},
		nullable: true
	})
	client: any | null;

	@ApiProperty({
		description: 'Whether the client creation was successful',
		example: true
	})
	success: boolean;

	@ApiProperty({
		description: 'Error message if creation failed',
		example: 'Email already exists',
		required: false
	})
	error?: string;

	@ApiProperty({
		description: 'Index of the client in the original request array',
		example: 0
	})
	index: number;

	@ApiProperty({
		description: 'Name of the client being created',
		example: 'LORO Corp'
	})
	name: string;

	@ApiProperty({
		description: 'Email of the client being created',
		example: 'theguy@example.co.za'
	})
	email: string;
}

/**
 * DTO for bulk client creation request
 */
export class BulkCreateClientDto {
	@IsArray()
	@IsNotEmpty()
	@ArrayMinSize(1, { message: 'At least one client must be provided' })
	@ArrayMaxSize(50, { message: 'Maximum 50 clients can be created at once' })
	@ValidateNested({ each: true })
	@Type(() => CreateClientDto)
	@ApiProperty({
		description: 'Array of clients to create (max 50)',
		type: [CreateClientDto],
		minItems: 1,
		maxItems: 50,
		example: [
			{
				name: 'LORO Corp',
				contactPerson: 'The Guy',
				email: 'theguy@example.co.za',
				phone: '+27 11 123 4567',
				website: 'https://www.example.co.za',
				category: 'enterprise',
				address: {
					street: '123 Innovation Drive',
					suburb: 'Pretoria South Africa',
					city: 'Pretoria',
					state: 'Gauteng',
					country: 'South Africa',
					postalCode: '0002'
				},
				creditLimit: 500000,
				priceTier: 'PREMIUM',
				industry: 'Technology',
				companySize: 250,
				assignedSalesRep: { uid: 1 }
			},
			{
				name: 'Digital Solutions SA',
				contactPerson: 'Business Manager',
				email: 'manager@digitalsolutions.co.za',
				phone: '+27 21 555 0123',
				website: 'https://www.digitalsolutions.co.za',
				category: 'enterprise',
				address: {
					street: '456 Technology Square',
					suburb: 'Cape Town',
					city: 'Cape Town',
					state: 'Western Cape',
					country: 'South Africa',
					postalCode: '8001'
				},
				creditLimit: 300000,
				priceTier: 'STANDARD',
				industry: 'Software Development',
				companySize: 150
			}
		]
	})
	clients: CreateClientDto[];

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Organization ID to associate clients with',
		example: 1,
		required: false
	})
	orgId?: number;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Branch ID to associate clients with',
		example: 1,
		required: false
	})
	branchId?: number;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to send welcome emails to created clients',
		example: true,
		default: true,
		required: false
	})
	sendWelcomeEmails?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to auto-assign sales representatives based on territory',
		example: true,
		default: false,
		required: false
	})
	autoAssignSalesReps?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to validate address coordinates and set up geofencing',
		example: true,
		default: false,
		required: false
	})
	validateAddresses?: boolean;
}

/**
 * DTO for bulk client creation response
 */
export class BulkCreateClientResponse {
	@ApiProperty({
		description: 'Total number of clients requested for creation',
		example: 10
	})
	totalRequested: number;

	@ApiProperty({
		description: 'Total number of clients successfully created',
		example: 8
	})
	totalCreated: number;

	@ApiProperty({
		description: 'Total number of clients that failed to be created',
		example: 2
	})
	totalFailed: number;

	@ApiProperty({
		description: 'Success rate as a percentage',
		example: 80.0
	})
	successRate: number;

	@ApiProperty({
		description: 'Detailed results for each client creation attempt',
		type: [BulkClientResult]
	})
	results: BulkClientResult[];

	@ApiProperty({
		description: 'Summary message of the bulk operation',
		example: 'Bulk creation completed: 8 clients created, 2 failed'
	})
	message: string;

	@ApiProperty({
		description: 'Array of error messages for failed creations',
		type: [String],
		required: false,
		example: ['Client 3 (invalid@email): Invalid email format', 'Client 7 (duplicate): Email already exists']
	})
	errors?: string[];

	@ApiProperty({
		description: 'Duration of the bulk operation in milliseconds',
		example: 1250
	})
	duration: number;

	@ApiProperty({
		description: 'Array of successfully created client IDs',
		type: [Number],
		required: false,
		example: [101, 102, 103, 104, 105, 106, 107, 108]
	})
	createdClientIds?: number[];

	@ApiProperty({
		description: 'Number of welcome emails sent',
		example: 8,
		required: false
	})
	welcomeEmailsSent?: number;

	@ApiProperty({
		description: 'Number of clients with auto-assigned sales reps',
		example: 6,
		required: false
	})
	autoAssignedSalesReps?: number;

	@ApiProperty({
		description: 'Number of addresses validated and geocoded',
		example: 8,
		required: false
	})
	addressesValidated?: number;
}
