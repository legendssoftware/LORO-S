import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsNumber, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateUserDto } from './update-user.dto';

/**
 * DTO for individual user update item in bulk operations
 */
export class BulkUserUpdateItem {
	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'User reference ID (uid) to update',
		example: 123
	})
	ref: number;

	@ValidateNested()
	@Type(() => UpdateUserDto)
	@ApiProperty({
		description: 'User data to update',
		type: () => UpdateUserDto,
		example: {
			name: 'Updated Name',
			phone: '+27 64 999 8888',
			accessLevel: 'MANAGER',
			assignedClientIds: [1, 2, 3, 4, 5]
		}
	})
	data: UpdateUserDto;
}

/**
 * DTO for individual user update result in bulk operations
 */
export class BulkUpdateUserResult {
	@ApiProperty({
		description: 'User reference ID that was updated',
		example: 123
	})
	ref: number;

	@ApiProperty({
		description: 'Whether the user update was successful',
		example: true
	})
	success: boolean;

	@ApiProperty({
		description: 'Error message if update failed',
		example: 'User not found',
		required: false
	})
	error?: string;

	@ApiProperty({
		description: 'Index of the update in the original request array',
		example: 0
	})
	index: number;

	@ApiProperty({
		description: 'Username of the updated user',
		example: 'theguy',
		required: false
	})
	username?: string;

	@ApiProperty({
		description: 'Email of the updated user',
		example: 'theguy@example.co.za',
		required: false
	})
	email?: string;

	@ApiProperty({
		description: 'List of fields that were updated',
		type: [String],
		example: ['name', 'phone', 'accessLevel', 'assignedClientIds'],
		required: false
	})
	updatedFields?: string[];
}

/**
 * DTO for bulk user update request
 */
export class BulkUpdateUserDto {
	@IsArray()
	@IsNotEmpty()
	@ArrayMinSize(1, { message: 'At least one user update must be provided' })
	@ArrayMaxSize(50, { message: 'Maximum 50 users can be updated at once' })
	@ValidateNested({ each: true })
	@Type(() => BulkUserUpdateItem)
	@ApiProperty({
		description: 'Array of user updates (max 50)',
		type: [BulkUserUpdateItem],
		minItems: 1,
		maxItems: 50,
		example: [
			{
				ref: 123,
				data: {
					name: 'The Guy Updated',
					phone: '+27 64 999 8888',
					accessLevel: 'MANAGER',
					assignedClientIds: [1, 2, 3, 4, 5]
				}
			},
			{
				ref: 124,
				data: {
					role: 'senior_developer',
					accessLevel: 'DEVELOPER',
					status: 'active',
					assignedClientIds: [6, 7, 8]
				}
			}
		]
	})
	updates: BulkUserUpdateItem[];

	@IsOptional()
	@ApiProperty({
		description: 'Whether to send notification emails for significant changes',
		example: true,
		default: true,
		required: false
	})
	sendNotificationEmails?: boolean;

	@IsOptional()
	@ApiProperty({
		description: 'Whether to validate assigned client IDs exist',
		example: true,
		default: true,
		required: false
	})
	validateClientIds?: boolean;
}

/**
 * DTO for bulk user update response
 */
export class BulkUpdateUserResponse {
	@ApiProperty({
		description: 'Total number of users requested for update',
		example: 10
	})
	totalRequested: number;

	@ApiProperty({
		description: 'Total number of users successfully updated',
		example: 9
	})
	totalUpdated: number;

	@ApiProperty({
		description: 'Total number of users that failed to be updated',
		example: 1
	})
	totalFailed: number;

	@ApiProperty({
		description: 'Success rate as a percentage',
		example: 90.0
	})
	successRate: number;

	@ApiProperty({
		description: 'Detailed results for each user update attempt',
		type: [BulkUpdateUserResult]
	})
	results: BulkUpdateUserResult[];

	@ApiProperty({
		description: 'Summary message of the bulk operation',
		example: 'Bulk update completed: 9 users updated, 1 failed'
	})
	message: string;

	@ApiProperty({
		description: 'Array of error messages for failed updates',
		type: [String],
		required: false,
		example: ['User ID 999: User not found']
	})
	errors?: string[];

	@ApiProperty({
		description: 'Duration of the bulk operation in milliseconds',
		example: 850
	})
	duration: number;

	@ApiProperty({
		description: 'Array of successfully updated user IDs',
		type: [Number],
		required: false,
		example: [123, 124, 125, 126, 127, 128, 129, 130, 131]
	})
	updatedUserIds?: number[];

	@ApiProperty({
		description: 'Number of notification emails sent',
		example: 5,
		required: false
	})
	notificationEmailsSent?: number;
}
