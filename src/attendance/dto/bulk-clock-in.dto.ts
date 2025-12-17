import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, IsNumber, IsBoolean, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CustomHoursDto {
	@ApiProperty({
		type: String,
		example: '2024-03-01',
		description: 'Date in YYYY-MM-DD format',
	})
	@IsString()
	date: string;

	@ApiProperty({
		type: String,
		example: '09:00',
		description: 'Check-in time in HH:mm format',
	})
	@IsString()
	checkIn: string;

	@ApiProperty({
		type: String,
		example: '17:00',
		description: 'Check-out time in HH:mm format',
	})
	@IsString()
	checkOut: string;
}

export class BulkClockInDto {
	@ApiProperty({
		type: [String],
		example: ['2024-03-01', '2024-03-02', '2024-03-03'],
		description: 'Array of dates to clock in users (YYYY-MM-DD format)',
	})
	@IsArray()
	@IsString({ each: true })
	dates: string[];

	@ApiProperty({
		type: [String],
		example: ['2024-03-02'],
		description: 'Array of dates that should be half days (YYYY-MM-DD format)',
		required: false,
	})
	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	halfDayDates?: string[];

	@ApiProperty({
		type: [CustomHoursDto],
		description: 'Custom hours for specific dates (overrides org hours)',
		required: false,
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CustomHoursDto)
	@IsOptional()
	customHours?: CustomHoursDto[];

	@ApiProperty({
		type: Number,
		example: 1,
		description: 'Optional branch ID to filter users',
		required: false,
	})
	@IsNumber()
	@IsOptional()
	branchId?: number;

	@ApiProperty({
		type: Boolean,
		example: false,
		description: 'Whether to skip users who already have attendance records for the dates',
		required: false,
		default: false,
	})
	@IsBoolean()
	@IsOptional()
	skipExisting?: boolean;
}

