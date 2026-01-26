import { IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConvertPointsDto {
	@ApiProperty({
		description: 'Points to convert to credit',
		example: 1000,
		minimum: 1,
	})
	@IsNumber()
	@IsNotEmpty()
	@Min(1)
	points: number;

	@ApiPropertyOptional({
		description: 'Optional reason for conversion',
		example: 'Requesting credit limit increase',
	})
	@IsOptional()
	reason?: string;
}
