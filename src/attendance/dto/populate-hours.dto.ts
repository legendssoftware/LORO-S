import { ApiProperty } from '@nestjs/swagger';
import {
	IsString,
	IsOptional,
	IsNumber,
	IsBoolean,
	IsDateString,
	Matches,
} from 'class-validator';

const HH_MM_REGEX = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Validates that date and time ranges are consistent (startDate <= endDate, clock-in range valid, clock-out range valid, clock-out after clock-in).
 * Call this from the service when processing PopulateHoursDto.
 */
export function validatePopulateHoursRanges(dto: PopulateHoursDto): void {
	const start = dto.startDate ? new Date(dto.startDate).getTime() : 0;
	const end = dto.endDate ? new Date(dto.endDate).getTime() : 0;
	if (start > end) {
		throw new Error('startDate must be <= endDate');
	}
	const timeToMinutes = (t: string) => {
		const [h, m] = t.split(':').map(Number);
		return (h ?? 0) * 60 + (m ?? 0);
	};
	const clockInStartM = timeToMinutes(dto.clockInTimeStart);
	const clockInEndM = timeToMinutes(dto.clockInTimeEnd);
	if (clockInStartM > clockInEndM) {
		throw new Error('clockInTimeStart must be <= clockInTimeEnd');
	}
	const clockOutStartM = timeToMinutes(dto.clockOutTimeStart);
	const clockOutEndM = timeToMinutes(dto.clockOutTimeEnd);
	if (clockOutStartM > clockOutEndM) {
		throw new Error('clockOutTimeStart must be <= clockOutTimeEnd');
	}
	if (clockOutStartM <= clockInEndM) {
		throw new Error('clock-out window must be after clock-in window on the same day');
	}
}

export class PopulateHoursDto {
	@ApiProperty({
		type: String,
		example: '2024-03-01',
		description: 'Start of date range (inclusive), YYYY-MM-DD',
	})
	@IsDateString()
	startDate: string;

	@ApiProperty({
		type: String,
		example: '2024-03-07',
		description: 'End of date range (inclusive), YYYY-MM-DD',
	})
	@IsDateString()
	endDate: string;

	@ApiProperty({
		type: String,
		example: '06:40',
		description: 'Start of clock-in time window (HH:mm)',
	})
	@IsString()
	@Matches(HH_MM_REGEX, { message: 'clockInTimeStart must be HH:mm' })
	clockInTimeStart: string;

	@ApiProperty({
		type: String,
		example: '07:22',
		description: 'End of clock-in time window (HH:mm)',
	})
	@IsString()
	@Matches(HH_MM_REGEX, { message: 'clockInTimeEnd must be HH:mm' })
	clockInTimeEnd: string;

	@ApiProperty({
		type: String,
		example: '16:30',
		description: 'Start of clock-out time window (HH:mm)',
	})
	@IsString()
	@Matches(HH_MM_REGEX, { message: 'clockOutTimeStart must be HH:mm' })
	clockOutTimeStart: string;

	@ApiProperty({
		type: String,
		example: '17:15',
		description: 'End of clock-out time window (HH:mm)',
	})
	@IsString()
	@Matches(HH_MM_REGEX, { message: 'clockOutTimeEnd must be HH:mm' })
	clockOutTimeEnd: string;

	@ApiProperty({
		type: Boolean,
		example: false,
		description: 'If true, return preview only; no DB writes',
		required: false,
		default: false,
	})
	@IsBoolean()
	@IsOptional()
	dryRun?: boolean;

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
		description: 'Skip users who already have an attendance record for that date',
		required: false,
		default: false,
	})
	@IsBoolean()
	@IsOptional()
	skipExisting?: boolean;
}
