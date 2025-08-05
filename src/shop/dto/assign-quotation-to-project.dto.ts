import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class AssignQuotationToProjectDto {
	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		example: 123,
		description: 'The unique identifier of the project to assign quotations to',
		minimum: 1,
	})
	projectId: number;

	@IsArray()
	@IsNotEmpty()
	@ApiProperty({
		example: [456, 789, 101],
		description: 'Array of quotation UIDs to assign to the project',
		type: [Number],
		minItems: 1,
	})
	quotationIds: number[];

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Assigning quotations for Phase 1 materials and equipment',
		description: 'Optional notes about the assignment',
		required: false,
		maxLength: 500,
	})
	notes?: string;
}

export class UnassignQuotationFromProjectDto {
	@IsArray()
	@IsNotEmpty()
	@ApiProperty({
		example: [456, 789],
		description: 'Array of quotation UIDs to unassign from the project',
		type: [Number],
		minItems: 1,
	})
	quotationIds: number[];

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Removing quotations as they are no longer applicable to this project',
		description: 'Optional reason for unassigning quotations',
		required: false,
		maxLength: 500,
	})
	reason?: string;
} 