import { ApiProperty } from '@nestjs/swagger';
import {
	IsNotEmpty,
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
	IsDecimal,
	Min,
	Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectType, ProjectStatus, ProjectPriority } from '../../lib/enums/project.enums';

export class ProjectAddressDto {
	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: '123 Construction Ave',
		description: 'Street address of the project location',
	})
	street: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'Sandton',
		description: 'Suburb or area of the project location',
	})
	suburb: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'Johannesburg',
		description: 'City where the project is located',
	})
	city: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'Gauteng',
		description: 'State or province of the project location',
	})
	state: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'South Africa',
		description: 'Country where the project is located',
	})
	country: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: '2196',
		description: 'Postal code of the project location',
	})
	postalCode: string;
}

export class CreateProjectDto {
	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'Sandton Office Complex Phase 1',
		description: 'The name of the project',
		minLength: 3,
		maxLength: 255,
	})
	name: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'A modern 15-story office complex with retail spaces on the ground floor and underground parking for 500 vehicles.',
		description: 'Detailed description of the project scope and objectives',
		required: false,
		maxLength: 5000,
	})
	description?: string;

	@IsEnum(ProjectType)
	@IsNotEmpty()
	@ApiProperty({
		enum: ProjectType,
		example: ProjectType.COMMERCIAL_BUILDING,
		description: 'The type/category of the project',
		enumName: 'ProjectType',
	})
	type: ProjectType;

	@IsEnum(ProjectStatus)
	@IsOptional()
	@ApiProperty({
		enum: ProjectStatus,
		example: ProjectStatus.PLANNING,
		description: 'Current status of the project',
		default: ProjectStatus.PLANNING,
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
		default: ProjectPriority.MEDIUM,
		required: false,
		enumName: 'ProjectPriority',
	})
	priority?: ProjectPriority;

	@IsNumber()
	@Min(0)
	@IsNotEmpty()
	@ApiProperty({
		example: 15000000.00,
		description: 'Total allocated budget for the project in ZAR',
		minimum: 0,
		type: 'number',
		format: 'decimal',
	})
	budget: number;

	@IsNumber()
	@Min(0)
	@IsOptional()
	@ApiProperty({
		example: 2500000.00,
		description: 'Amount already spent on the project in ZAR',
		minimum: 0,
		default: 0,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	currentSpent?: number;

	@IsNumber()
	@Min(0)
	@IsOptional()
	@ApiProperty({
		example: 16000000.00,
		description: 'Project value - expected contract/revenue value (may differ from budget)',
		minimum: 0,
		default: 0,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	value?: number;

	@IsNumber()
	@Min(0)
	@IsOptional()
	@ApiProperty({
		example: 0,
		description: 'Total cost - actual total cost (manual or from linked invoices)',
		minimum: 0,
		default: 0,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	totalCost?: number;

	@IsArray()
	@IsOptional()
	@ApiProperty({
		example: ['INV-2024-001', 'INV-2024-002'],
		description: 'Linked invoice references (e.g. ERP document numbers)',
		type: [String],
		required: false,
	})
	linkedInvoices?: string[];

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'John Smith',
		description: 'Name of the primary contact person for this project',
		maxLength: 255,
	})
	contactPerson: string;

	@IsEmail()
	@IsOptional()
	@ApiProperty({
		example: 'john.smith@construction.co.za',
		description: 'Email address of the project contact person',
		required: false,
	})
	contactEmail?: string;

	@IsPhoneNumber()
	@IsOptional()
	@ApiProperty({
		example: '+27 11 123 4567',
		description: 'Phone number of the project contact person',
		required: false,
	})
	contactPhone?: string;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2024-03-01T00:00:00Z',
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
		example: '2025-12-31T00:00:00Z',
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
		example: '2025-11-30T00:00:00Z',
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
		example: ['HVAC system', 'Smart building controls', 'Solar panels', 'Rainwater harvesting'],
		description: 'List of specific requirements and features for the project',
		type: [String],
		required: false,
	})
	requirements?: string[];

	@IsArray()
	@IsOptional()
	@ApiProperty({
		example: ['commercial', 'green-building', 'high-priority', 'phase-1'],
		description: 'Tags for categorizing and filtering the project',
		type: [String],
		required: false,
	})
	tags?: string[];

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Client requires LEED Gold certification. Must coordinate with existing building systems. Phased construction to minimize disruption.',
		description: 'Additional notes and important information about the project',
		maxLength: 5000,
		required: false,
	})
	notes?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'ZAR',
		description: 'Currency code for the project budget',
		default: 'ZAR',
		required: false,
		maxLength: 6,
	})
	currency?: string;

	@IsNumber()
	@Min(0)
	@Max(100)
	@IsOptional()
	@ApiProperty({
		example: 15.5,
		description: 'Current completion percentage of the project',
		minimum: 0,
		maximum: 100,
		default: 0,
		required: false,
		type: 'number',
		format: 'decimal',
	})
	progressPercentage?: number;

	@IsObject()
	@IsNotEmpty()
	@ApiProperty({
		example: { uid: 123 },
		description: 'Reference to the client who owns this project',
		type: 'object',
		properties: {
			uid: { type: 'number', example: 123, description: 'Client unique identifier' },
		},
	})
	client: { uid: number };

	@IsObject()
	@IsNotEmpty()
	@ApiProperty({
		example: { uid: 456 },
		description: 'Reference to the user assigned to manage this project',
		type: 'object',
		properties: {
			uid: { type: 'number', example: 456, description: 'User unique identifier' },
		},
	})
	assignedUser: { uid: number };
} 