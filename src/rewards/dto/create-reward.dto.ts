import { IsNotEmpty, IsNumber, IsOptional, IsString, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SourceDto {
	@ApiProperty({
		description: 'Source ID',
		example: '1'
	})
	@IsString()
	@IsNotEmpty()
	id: string;

	@ApiProperty({
		description: 'Source type',
		example: 'ATTENDANCE'
	})
	@IsString()
	@IsNotEmpty()
	type: string;

	@ApiPropertyOptional({
		description: 'Source details',
		example: 'Check-in reward'
	})
	@IsString()
	@IsOptional()
	details?: string;
}

export class CreateRewardDto {
	@ApiProperty({
		description: 'User ID to award XP to',
		example: 1
	})
	@IsNumber()
	@IsNotEmpty()
	owner: number;

	@ApiProperty({
		description: 'Amount of XP to award',
		example: 100
	})
	@IsNumber()
	@IsNotEmpty()
	amount: number;

	@ApiProperty({
		description: 'Action that triggered the XP award',
		example: 'TASK_COMPLETED'
	})
	@IsString()
	@IsNotEmpty()
	action: string;

	@ApiPropertyOptional({
		description: 'Description of the XP award',
		example: 'Completed task: Review proposal'
	})
	@IsString()
	@IsOptional()
	description?: string;

	@ApiPropertyOptional({
		description: 'Source information for the XP award',
		type: SourceDto
	})
	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => SourceDto)
	source?: SourceDto;

	@ApiPropertyOptional({
		description: 'Additional metadata',
		example: { taskId: 123 }
	})
	@IsOptional()
	metadata?: any;
}
