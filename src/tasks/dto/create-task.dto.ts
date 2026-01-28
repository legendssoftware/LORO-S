import {
	IsString,
	IsOptional,
	IsEnum,
	IsArray,
	IsDate,
	IsNotEmpty,
	IsNumber,
	ValidateNested,
	ArrayMinSize,
} from 'class-validator';
import { TaskPriority, RepetitionType, TaskType } from '../../lib/enums/task.enums';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AssigneeDto {
	@ApiProperty({ description: 'User ID', example: 1 })
	@IsNumber()
	@IsNotEmpty()
	uid: number;
}

export class ClientDto {
	@ApiProperty({ description: 'Client ID', example: 1 })
	@IsNumber()
	@IsNotEmpty()
	uid: number;

	@ApiProperty({ description: 'Client name', example: 'John Doe' })
	@IsString()
	@IsOptional()
	name?: string;

	@ApiProperty({ description: 'Client email', example: 'john@example.com' })
	@IsString()
	@IsOptional()
	email?: string;

	@ApiProperty({ description: 'Client address' })
	@IsString()
	@IsOptional()
	address?: string;

	@ApiProperty({ description: 'Client phone' })
	@IsString()
	@IsOptional()
	phone?: string;

	@ApiProperty({ description: 'Client contact person' })
	@IsString()
	@IsOptional()
	contactPerson?: string;
}

export class SubtaskDto {
	@ApiProperty({ description: 'Subtask title', example: 'Sub Task One' })
	@IsString()
	@IsNotEmpty()
	title: string;

	@ApiProperty({ description: 'Subtask description', example: 'Sub task description' })
	@IsString()
	@IsNotEmpty()
	description: string;
}

export class CreateTaskDto {
	@ApiProperty({
		description: 'The title of the task',
		example: 'Test Task',
	})
	@IsString()
	@IsNotEmpty()
	title: string;

	@ApiProperty({
		description: 'The description of the task',
		example: 'Test description',
	})
	@IsString()
	@IsNotEmpty()
	description: string;

	@ApiProperty({
		description: 'The type of task',
		enum: TaskType,
		example: TaskType.IN_PERSON_MEETING,
	})
	@IsEnum(TaskType)
	@IsNotEmpty()
	taskType: TaskType;

	@ApiProperty({
		description: 'The priority level of the task',
		enum: TaskPriority,
		example: TaskPriority.HIGH,
	})
	@IsEnum(TaskPriority)
	@IsNotEmpty()
	priority: TaskPriority;

	@ApiProperty({
		description: 'The deadline for the task completion',
		example: `${new Date()}`,
	})
	@Type(() => Date)
	@IsDate()
	@IsOptional()
	deadline?: Date;

	@ApiProperty({
		description: 'How often the task should repeat',
		enum: RepetitionType,
		example: RepetitionType.MONTHLY,
	})
	@IsEnum(RepetitionType)
	@IsOptional()
	repetitionType?: RepetitionType;

	@ApiProperty({
		description: 'The deadline for task repetition',
		example: `${new Date()}`,
	})
	@Type(() => Date)
	@IsDate()
	@IsOptional()
	repetitionDeadline?: Date;

	@ApiProperty({
		description: 'Array of assignees',
		type: [AssigneeDto],
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => AssigneeDto)
	@IsOptional()
	assignees?: AssigneeDto[];

	@ApiProperty({
		description: 'Array of clients',
		type: [ClientDto],
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ClientDto)
	@IsOptional()
	client?: ClientDto[];

	@ApiProperty({
		description: 'Target category for bulk client assignment',
		example: 'enterprise',
	})
	@IsString()
	@IsOptional()
	targetCategory?: string;

	@ApiProperty({
		description: 'Array of subtasks',
		type: [SubtaskDto],
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => SubtaskDto)
	@IsOptional()
	subtasks?: SubtaskDto[];

	@ApiProperty({
		description: 'Array of file attachments for the task',
		example: ['https://cdn-icons-png.flaticon.com/512/3607/3607444.png'],
		type: [String],
	})
	@IsArray()
	@IsOptional()
	attachments?: string[];

	@ApiProperty({
		description: 'Comments',
		example: 'Just a testing task',
	})
	@IsString()
	@IsOptional()
	comment?: string;

	@ApiProperty({
		description: 'Organisation ID',
		example: 1,
	})
	@IsNumber()
	@IsOptional()
	organisationId?: number;

	@ApiProperty({
		description: 'Branch ID',
		example: 1,
	})
	@IsNumber()
	@IsOptional()
	branchId?: number;
}
