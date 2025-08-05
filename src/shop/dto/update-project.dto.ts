import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateProjectDto, ProjectAddressDto } from './create-project.dto';
import {
	IsString,
	IsEnum,
	IsOptional,
	IsNumber,
	IsDate,
	IsEmail,
	IsPhoneNumber,
	IsObject,
	IsArray,
	ValidateNested,
	Min,
	Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectType, ProjectStatus, ProjectPriority } from '../../lib/enums/project.enums';

/**
 * UpdateProjectDto - Extends CreateProjectDto to allow partial updates
 *
 * All fields are optional in this DTO since projects can be updated
 * with only the fields that need to be changed.
 */
export class UpdateProjectDto extends PartialType(CreateProjectDto) {
	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Sandton Office Complex Phase 1 - Updated',
		description: 'The name of the project',
		required: false,
	})
	name?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Updated project description with new requirements and scope changes.',
		description: 'Detailed description of the project scope and objectives',
		required: false,
	})
	description?: string;

	@IsEnum(ProjectType)
	@IsOptional()
	@ApiProperty({
		enum: ProjectType,
		example: ProjectType.COMMERCIAL_BUILDING,
		description: 'The type/category of the project',
		required: false,
		enumName: 'ProjectType',
	})
	type?: ProjectType;

	@IsEnum(ProjectStatus)
	@IsOptional()
	@ApiProperty({
		enum: ProjectStatus,
		example: ProjectStatus.IN_PROGRESS,
		description: 'Current status of the project',
		required: false,
		enumName: 'ProjectStatus',
	})
	status?: ProjectStatus;

	@IsEnum(ProjectPriority)
	@IsOptional()
	@ApiProperty({
		enum: ProjectPriority,
		example: ProjectPriority.HIGH,
		description: 'Priority level of the project',
		required: false,
		enumName: 'ProjectPriority',
	})
	priority?: ProjectPriority;

	@IsNumber()
	@Min(0)
	@IsOptional()
	@ApiProperty({
		example: 18000000.00,
		description: 'Total allocated budget for the project in ZAR',
		minimum: 0,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	budget?: number;

	@IsNumber()
	@Min(0)
	@IsOptional()
	@ApiProperty({
		example: 3500000.00,
		description: 'Amount already spent on the project in ZAR',
		minimum: 0,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	currentSpent?: number;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Jane Doe',
		description: 'Name of the primary contact person for this project',
		required: false,
	})
	contactPerson?: string;

	@IsEmail()
	@IsOptional()
	@ApiProperty({
		example: 'jane.doe@construction.co.za',
		description: 'Email address of the project contact person',
		required: false,
	})
	contactEmail?: string;

	@IsPhoneNumber()
	@IsOptional()
	@ApiProperty({
		example: '+27 11 987 6543',
		description: 'Phone number of the project contact person',
		required: false,
	})
	contactPhone?: string;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2024-04-01T00:00:00Z',
		description: 'Planned start date of the project',
		type: 'string',
		format: 'date-time',
		required: false,
	})
	startDate?: Date;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2026-01-31T00:00:00Z',
		description: 'Planned end date of the project',
		type: 'string',
		format: 'date-time',
		required: false,
	})
	endDate?: Date;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2025-12-15T00:00:00Z',
		description: 'Expected completion date of the project',
		type: 'string',
		format: 'date-time',
		required: false,
	})
	expectedCompletionDate?: Date;

	@ValidateNested()
	@Type(() => ProjectAddressDto)
	@IsOptional()
	@ApiProperty({
		description: 'Physical address where the project is located',
		type: ProjectAddressDto,
		required: false,
	})
	address?: ProjectAddressDto;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: -26.1043,
		description: 'Latitude coordinate of the project location',
		minimum: -90,
		maximum: 90,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	latitude?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: 28.0473,
		description: 'Longitude coordinate of the project location',
		minimum: -180,
		maximum: 180,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	longitude?: number;

	@IsArray()
	@IsOptional()
	@ApiProperty({
		example: ['HVAC system', 'Updated smart controls', 'Enhanced solar system'],
		description: 'List of specific requirements and features for the project',
		type: [String],
		required: false,
	})
	requirements?: string[];

	@IsArray()
	@IsOptional()
	@ApiProperty({
		example: ['commercial', 'green-building', 'updated-scope', 'phase-1'],
		description: 'Tags for categorizing and filtering the project',
		type: [String],
		required: false,
	})
	tags?: string[];

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Updated notes: Budget increased due to scope changes. Timeline extended by 2 months.',
		description: 'Additional notes and important information about the project',
		required: false,
	})
	notes?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'ZAR',
		description: 'Currency code for the project budget',
		required: false,
	})
	currency?: string;

	@IsNumber()
	@Min(0)
	@Max(100)
	@IsOptional()
	@ApiProperty({
		example: 35.8,
		description: 'Current completion percentage of the project',
		minimum: 0,
		maximum: 100,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	progressPercentage?: number;

	@IsObject()
	@IsOptional()
	@ApiProperty({
		example: { uid: 789 },
		description: 'Reference to the client who owns this project',
		type: 'object',
		properties: {
			uid: { type: 'number', example: 789, description: 'Client unique identifier' },
		},
	})
	client?: { uid: number };

	@IsObject()
	@IsOptional()
	@ApiProperty({
		example: { uid: 654 },
		description: 'Reference to the user assigned to manage this project',
		type: 'object',
		properties: {
			uid: { type: 'number', example: 654, description: 'User unique identifier' },
		},
	})
	assignedUser?: { uid: number };
} 