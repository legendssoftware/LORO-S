import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsNumber, ValidateNested, ArrayMinSize, ArrayMaxSize, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateClientDto } from './update-client.dto';

/**
 * DTO for individual client update item in bulk operations
 */
export class BulkClientUpdateItem {
	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Client reference ID (uid) to update',
		example: 123
	})
	ref: number;

	@ValidateNested()
	@Type(() => UpdateClientDto)
	@ApiProperty({
		description: 'Client data to update',
		type: () => UpdateClientDto,
		example: {
			contactPerson: 'Updated Contact Person',
			phone: '+27 11 999 8888',
			creditLimit: 750000,
			priceTier: 'PREMIUM'
		}
	})
	data: UpdateClientDto;
}

/**
 * DTO for individual client update result in bulk operations
 */
export class BulkUpdateClientResult {
	@ApiProperty({
		description: 'Client reference ID that was updated',
		example: 123
	})
	ref: number;

	@ApiProperty({
		description: 'Whether the client update was successful',
		example: true
	})
	success: boolean;

	@ApiProperty({
		description: 'Error message if update failed',
		example: 'Client not found',
		required: false
	})
	error?: string;

	@ApiProperty({
		description: 'Index of the update in the original request array',
		example: 0
	})
	index: number;

	@ApiProperty({
		description: 'Name of the updated client',
		example: 'LORO Corp',
		required: false
	})
	name?: string;

	@ApiProperty({
		description: 'Email of the updated client',
		example: 'theguy@example.co.za',
		required: false
	})
	email?: string;

	@ApiProperty({
		description: 'List of fields that were updated',
		type: [String],
		example: ['contactPerson', 'phone', 'creditLimit', 'priceTier'],
		required: false
	})
	updatedFields?: string[];
}

/**
 * DTO for bulk client update request
 */
export class BulkUpdateClientDto {
	@IsArray()
	@IsNotEmpty()
	@ArrayMinSize(1, { message: 'At least one client update must be provided' })
	@ArrayMaxSize(50, { message: 'Maximum 50 clients can be updated at once' })
	@ValidateNested({ each: true })
	@Type(() => BulkClientUpdateItem)
	@ApiProperty({
		description: 'Array of client updates (max 50)',
		type: [BulkClientUpdateItem],
		minItems: 1,
		maxItems: 50,
		example: [
			{
				ref: 123,
				data: {
					contactPerson: 'Updated Contact Person',
					phone: '+27 11 999 8888',
					creditLimit: 750000,
					priceTier: 'PREMIUM',
					assignedSalesRep: { uid: 2 }
				}
			},
			{
				ref: 124,
				data: {
					category: 'enterprise',
					outstandingBalance: 50000,
					nextContactDate: '2024-02-15T10:00:00Z',
					tags: ['VIP', 'High Value', 'Strategic']
				}
			}
		]
	})
	updates: BulkClientUpdateItem[];

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to send notification emails for significant changes',
		example: true,
		default: true,
		required: false
	})
	sendNotificationEmails?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to validate assigned sales rep IDs exist',
		example: true,
		default: true,
		required: false
	})
	validateSalesReps?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to update address coordinates if address is changed',
		example: true,
		default: false,
		required: false
	})
	updateCoordinates?: boolean;
}

/**
 * DTO for bulk client update response
 */
export class BulkUpdateClientResponse {
	@ApiProperty({
		description: 'Total number of clients requested for update',
		example: 10
	})
	totalRequested: number;

	@ApiProperty({
		description: 'Total number of clients successfully updated',
		example: 9
	})
	totalUpdated: number;

	@ApiProperty({
		description: 'Total number of clients that failed to be updated',
		example: 1
	})
	totalFailed: number;

	@ApiProperty({
		description: 'Success rate as a percentage',
		example: 90.0
	})
	successRate: number;

	@ApiProperty({
		description: 'Detailed results for each client update attempt',
		type: [BulkUpdateClientResult]
	})
	results: BulkUpdateClientResult[];

	@ApiProperty({
		description: 'Summary message of the bulk operation',
		example: 'Bulk update completed: 9 clients updated, 1 failed'
	})
	message: string;

	@ApiProperty({
		description: 'Array of error messages for failed updates',
		type: [String],
		required: false,
		example: ['Client ID 999: Client not found']
	})
	errors?: string[];

	@ApiProperty({
		description: 'Duration of the bulk operation in milliseconds',
		example: 850
	})
	duration: number;

	@ApiProperty({
		description: 'Array of successfully updated client IDs',
		type: [Number],
		required: false,
		example: [123, 124, 125, 126, 127, 128, 129, 130, 131]
	})
	updatedClientIds?: number[];

	@ApiProperty({
		description: 'Number of notification emails sent',
		example: 5,
		required: false
	})
	notificationEmailsSent?: number;

	@ApiProperty({
		description: 'Number of addresses with updated coordinates',
		example: 3,
		required: false
	})
	coordinatesUpdated?: number;
}
