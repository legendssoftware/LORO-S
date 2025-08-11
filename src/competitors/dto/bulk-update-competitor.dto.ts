import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsNumber, ValidateNested, ArrayMinSize, ArrayMaxSize, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateCompetitorDto } from './update-competitor.dto';

/**
 * DTO for individual competitor update item in bulk operations
 */
export class BulkCompetitorUpdateItem {
	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Competitor reference ID (uid) to update',
		example: 123
	})
	ref: number;

	@ValidateNested()
	@Type(() => UpdateCompetitorDto)
	@ApiProperty({
		description: 'Competitor data to update',
		type: () => UpdateCompetitorDto,
		example: {
			threatLevel: 5,
			estimatedAnnualRevenue: 75000000,
			keyStrengths: ['Market leader', 'Innovation', 'Strong partnerships'],
			competitiveAdvantage: 4
		}
	})
	data: UpdateCompetitorDto;
}

/**
 * DTO for individual competitor update result in bulk operations
 */
export class BulkUpdateCompetitorResult {
	@ApiProperty({
		description: 'Competitor reference ID that was updated',
		example: 123
	})
	ref: number;

	@ApiProperty({
		description: 'Whether the competitor update was successful',
		example: true
	})
	success: boolean;

	@ApiProperty({
		description: 'Error message if update failed',
		example: 'Competitor not found',
		required: false
	})
	error?: string;

	@ApiProperty({
		description: 'Index of the update in the original request array',
		example: 0
	})
	index: number;

	@ApiProperty({
		description: 'Name of the updated competitor',
		example: 'Tech Innovations SA',
		required: false
	})
	name?: string;

	@ApiProperty({
		description: 'Website of the updated competitor',
		example: 'https://techinnovations.co.za',
		required: false
	})
	website?: string;

	@ApiProperty({
		description: 'List of fields that were updated',
		type: [String],
		example: ['threatLevel', 'estimatedAnnualRevenue', 'keyStrengths', 'competitiveAdvantage'],
		required: false
	})
	updatedFields?: string[];
}

/**
 * DTO for bulk competitor update request
 */
export class BulkUpdateCompetitorDto {
	@IsArray()
	@IsNotEmpty()
	@ArrayMinSize(1, { message: 'At least one competitor update must be provided' })
	@ArrayMaxSize(50, { message: 'Maximum 50 competitors can be updated at once' })
	@ValidateNested({ each: true })
	@Type(() => BulkCompetitorUpdateItem)
	@ApiProperty({
		description: 'Array of competitor updates (max 50)',
		type: [BulkCompetitorUpdateItem],
		minItems: 1,
		maxItems: 50,
		example: [
			{
				ref: 123,
				data: {
					threatLevel: 5,
					estimatedAnnualRevenue: 75000000,
					keyStrengths: ['Market leader', 'Innovation', 'Strong partnerships'],
					competitiveAdvantage: 4,
					status: 'ACTIVE'
				}
			},
			{
				ref: 124,
				data: {
					threatLevel: 2,
					competitiveAdvantage: 2,
					keyWeaknesses: ['Limited resources', 'Poor customer service', 'Outdated technology'],
					status: 'INACTIVE'
				}
			}
		]
	})
	updates: BulkCompetitorUpdateItem[];

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to validate URLs if they are being updated',
		example: true,
		default: true,
		required: false
	})
	validateUrls?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to recalculate threat levels based on updated data',
		example: false,
		default: false,
		required: false
	})
	recalculateThreatLevels?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether to update geofencing if location data changes',
		example: true,
		default: false,
		required: false
	})
	updateGeofencing?: boolean;
}

/**
 * DTO for bulk competitor update response
 */
export class BulkUpdateCompetitorResponse {
	@ApiProperty({
		description: 'Total number of competitors requested for update',
		example: 10
	})
	totalRequested: number;

	@ApiProperty({
		description: 'Total number of competitors successfully updated',
		example: 9
	})
	totalUpdated: number;

	@ApiProperty({
		description: 'Total number of competitors that failed to be updated',
		example: 1
	})
	totalFailed: number;

	@ApiProperty({
		description: 'Success rate as a percentage',
		example: 90.0
	})
	successRate: number;

	@ApiProperty({
		description: 'Detailed results for each competitor update attempt',
		type: [BulkUpdateCompetitorResult]
	})
	results: BulkUpdateCompetitorResult[];

	@ApiProperty({
		description: 'Summary message of the bulk operation',
		example: 'Bulk update completed: 9 competitors updated, 1 failed'
	})
	message: string;

	@ApiProperty({
		description: 'Array of error messages for failed updates',
		type: [String],
		required: false,
		example: ['Competitor ID 999: Competitor not found']
	})
	errors?: string[];

	@ApiProperty({
		description: 'Duration of the bulk operation in milliseconds',
		example: 850
	})
	duration: number;

	@ApiProperty({
		description: 'Array of successfully updated competitor IDs',
		type: [Number],
		required: false,
		example: [123, 124, 125, 126, 127, 128, 129, 130, 131]
	})
	updatedCompetitorIds?: number[];

	@ApiProperty({
		description: 'Number of URLs validated',
		example: 5,
		required: false
	})
	urlsValidated?: number;

	@ApiProperty({
		description: 'Number of threat levels recalculated',
		example: 3,
		required: false
	})
	threatLevelsRecalculated?: number;

	@ApiProperty({
		description: 'Number of geofences updated',
		example: 2,
		required: false
	})
	geofencesUpdated?: number;
}
