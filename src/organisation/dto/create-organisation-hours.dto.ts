import { IsString, IsOptional, IsArray, ValidateNested, Matches, IsBoolean, IsDateString } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { WeeklyScheduleDto } from './weekly-schedule.dto';
import { SpecialHoursDto } from './special-hours.dto';

// DTO for individual day schedule
export class DayScheduleDto {
	@ApiProperty({ description: 'Start time for the day (HH:mm)', example: '09:00' })
	@IsString()
	@Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
	start: string;

	@ApiProperty({ description: 'End time for the day (HH:mm)', example: '17:00' })
	@IsString()
	@Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
	end: string;

	@ApiProperty({ description: 'Whether the business is closed on this day', example: false })
	@IsBoolean()
	closed: boolean;
}

// DTO for complete schedule
export class ScheduleDto {
	@ApiProperty({ type: DayScheduleDto })
	@ValidateNested()
	@Type(() => DayScheduleDto)
	monday: DayScheduleDto;

	@ApiProperty({ type: DayScheduleDto })
	@ValidateNested()
	@Type(() => DayScheduleDto)
	tuesday: DayScheduleDto;

	@ApiProperty({ type: DayScheduleDto })
	@ValidateNested()
	@Type(() => DayScheduleDto)
	wednesday: DayScheduleDto;

	@ApiProperty({ type: DayScheduleDto })
	@ValidateNested()
	@Type(() => DayScheduleDto)
	thursday: DayScheduleDto;

	@ApiProperty({ type: DayScheduleDto })
	@ValidateNested()
	@Type(() => DayScheduleDto)
	friday: DayScheduleDto;

	@ApiProperty({ type: DayScheduleDto })
	@ValidateNested()
	@Type(() => DayScheduleDto)
	saturday: DayScheduleDto;

	@ApiProperty({ type: DayScheduleDto })
	@ValidateNested()
	@Type(() => DayScheduleDto)
	sunday: DayScheduleDto;
}

export class CreateOrganisationHoursDto {
	@ApiProperty({ 
		description: 'Default opening time in 24-hour format (HH:mm) - used if specific days are not configured', 
		example: '08:30', 
		required: false 
	})
	@IsString()
	@Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
	openTime: string;

	@ApiProperty({ 
		description: 'Default closing time in 24-hour format (HH:mm) - used if specific days are not configured', 
		example: '18:00', 
		required: false 
	})
	@IsString()
	@Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
	closeTime: string;

	@ApiProperty({
		type: WeeklyScheduleDto,
		required: false,
		description: 'Simple boolean flags for which days are working days',
	})
	@ValidateNested()
	@Type(() => WeeklyScheduleDto)
	@IsOptional()
	weeklySchedule?: WeeklyScheduleDto;

	@ApiProperty({
		type: ScheduleDto,
		required: false,
		description: 'Detailed schedule with specific times for each day',
	})
	@ValidateNested()
	@Type(() => ScheduleDto)
	@IsOptional()
	schedule?: ScheduleDto;

	@ApiProperty({
		description: 'Organization timezone',
		example: 'America/New_York',
		required: false
	})
	@IsString()
	@IsOptional()
	timezone?: string;

	@ApiProperty({
		description: 'Whether holiday mode is enabled',
		example: false,
		required: false
	})
	@IsBoolean()
	@IsOptional()
	holidayMode?: boolean;

	@ApiProperty({
		description: 'Holiday end date (ISO string)',
		example: '2024-01-02T00:00:00.000Z',
		required: false
	})
	@IsOptional()
	@Transform(({ value }) => value ? new Date(value) : undefined)
	holidayUntil?: Date;

	@ApiProperty({
		type: [SpecialHoursDto],
		required: false,
		description: 'Special business hours for holidays, events, or temporary schedule changes',
		example: [
			{
				date: '2024-01-01',
				openTime: '00:00',
				closeTime: '00:00',
				reason: 'New Year\'s Day - Closed',
			},
			{
				date: '2024-07-04',
				openTime: '10:00',
				closeTime: '14:00',
				reason: 'Independence Day - Limited Hours',
			},
			{
				date: '2024-11-29',
				openTime: '00:00',
				closeTime: '00:00',
				reason: 'Black Friday - Closed for Staff Holiday',
			},
			{
				date: '2024-12-24',
				openTime: '08:30',
				closeTime: '13:00',
				reason: 'Christmas Eve - Early Closing',
			},
		],
	})
	@IsArray()
	@IsOptional()
	@ValidateNested({ each: true })
	@Type(() => SpecialHoursDto)
	specialHours?: SpecialHoursDto[];
}
