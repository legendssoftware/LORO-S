import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsArray, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class MonthlyMetricsQueryDto {
	@ApiProperty({
		description: 'Year for monthly metrics (YYYY format). Defaults to current year if not specified.',
		example: 2024,
		required: false,
	})
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	year?: number;

	@ApiProperty({
		description: 'Month for metrics (1-12). Defaults to current month if not specified.',
		example: 3,
		required: false,
	})
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	month?: number;

	@ApiProperty({
		description:
			'Array of dates (YYYY-MM-DD format) to exclude from overtime calculation. For these dates, hours will be capped at organization maximum work hours if exceeded, otherwise left as-is.',
		example: ['2024-03-15', '2024-03-20', '2024-03-25'],
		type: [String],
		required: false,
	})
	@IsOptional()
	@IsArray()
	@IsDateString({}, { each: true })
	excludeOvertimeDates?: string[];

	@ApiProperty({
		description: "Organization ID to filter metrics. If not provided, uses authenticated user's organization.",
		example: 1,
		required: false,
	})
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	orgId?: number;

	@ApiProperty({
		description: 'Branch ID to filter metrics. If not provided, includes all branches.',
		example: 5,
		required: false,
	})
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	branchId?: number;
}

