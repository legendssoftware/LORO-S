import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsNumber, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateUserDto } from './create-user.dto';

/**
 * DTO for individual user creation result in bulk operations
 */
export class BulkUserResult {
	@ApiProperty({
		description: 'Created user object or null if creation failed',
		example: {
			uid: 123,
			username: 'theguy',
			name: 'The Guy',
			surname: 'Developer',
			email: 'theguy@example.co.za',
			accessLevel: 'USER',
			status: 'active'
		},
		nullable: true
	})
	user: any | null;

	@ApiProperty({
		description: 'Whether the user creation was successful',
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
		description: 'Index of the user in the original request array',
		example: 0
	})
	index: number;

	@ApiProperty({
		description: 'Username of the user being created',
		example: 'theguy'
	})
	username: string;

	@ApiProperty({
		description: 'Email of the user being created',
		example: 'theguy@example.co.za'
	})
	email: string;
}

/**
 * DTO for bulk user creation request
 */
export class BulkCreateUserDto {
	@IsArray()
	@IsNotEmpty()
	@ArrayMinSize(1, { message: 'At least one user must be provided' })
	@ArrayMaxSize(50, { message: 'Maximum 50 users can be created at once' })
	@ValidateNested({ each: true })
	@Type(() => CreateUserDto)
	@ApiProperty({
		description: 'Array of users to create (max 50)',
		type: [CreateUserDto],
		minItems: 1,
		maxItems: 50,
		example: [
			{
				username: 'theguy',
				password: 'SecurePass123!',
				name: 'The Guy',
				surname: 'Developer',
				email: 'theguy@example.co.za',
				phone: '+27 64 123 4567',
				role: 'developer',
				accessLevel: 'DEVELOPER',
				organisationRef: 'ORG001',
				assignedClientIds: [1, 2, 3]
			},
			{
				username: 'salesmanager',
				password: 'SecurePass456!',
				name: 'Sales',
				surname: 'Manager',
				email: 'sales.manager@example.co.za',
				phone: '+27 64 765 4321',
				role: 'manager',
				accessLevel: 'MANAGER',
				organisationRef: 'ORG001',
				assignedClientIds: [4, 5, 6, 7]
			}
		]
	})
	users: CreateUserDto[];

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Organization ID to associate users with',
		example: 1,
		required: false
	})
	orgId?: number;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Branch ID to associate users with',
		example: 1,
		required: false
	})
	branchId?: number;

	@IsOptional()
	@ApiProperty({
		description: 'Whether to send welcome emails to created users',
		example: true,
		default: true,
		required: false
	})
	sendWelcomeEmails?: boolean;

	@IsOptional()
	@ApiProperty({
		description: 'Whether to auto-generate passwords for users without passwords',
		example: false,
		default: false,
		required: false
	})
	autoGeneratePasswords?: boolean;
}

/**
 * DTO for bulk user creation response
 */
export class BulkCreateUserResponse {
	@ApiProperty({
		description: 'Total number of users requested for creation',
		example: 10
	})
	totalRequested: number;

	@ApiProperty({
		description: 'Total number of users successfully created',
		example: 8
	})
	totalCreated: number;

	@ApiProperty({
		description: 'Total number of users that failed to be created',
		example: 2
	})
	totalFailed: number;

	@ApiProperty({
		description: 'Success rate as a percentage',
		example: 80.0
	})
	successRate: number;

	@ApiProperty({
		description: 'Detailed results for each user creation attempt',
		type: [BulkUserResult]
	})
	results: BulkUserResult[];

	@ApiProperty({
		description: 'Summary message of the bulk operation',
		example: 'Bulk creation completed: 8 users created, 2 failed'
	})
	message: string;

	@ApiProperty({
		description: 'Array of error messages for failed creations',
		type: [String],
		required: false,
		example: ['User 3 (invalid@email): Invalid email format', 'User 7 (duplicate): Username already exists']
	})
	errors?: string[];

	@ApiProperty({
		description: 'Duration of the bulk operation in milliseconds',
		example: 1250
	})
	duration: number;

	@ApiProperty({
		description: 'Array of successfully created user IDs',
		type: [Number],
		required: false,
		example: [101, 102, 103, 104, 105, 106, 107, 108]
	})
	createdUserIds?: number[];

	@ApiProperty({
		description: 'Number of welcome emails sent',
		example: 8,
		required: false
	})
	welcomeEmailsSent?: number;
}
