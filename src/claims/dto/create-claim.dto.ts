import { IsNotEmpty, IsNumber, IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ClaimCategory, Currency } from '../../lib/enums/finance.enums';

export class CreateClaimDto {
	@ApiProperty({
		example: 'This is a description of the claim',
		description: 'Description of the claim',
	})
	@IsOptional()
	@IsString()
	comment: string;

	@ApiProperty({
		example: 1000,
		description: 'Amount being claimed',
	})
	@IsNotEmpty()
	@IsNumber()
	amount: number;

	@ApiProperty({
		example: 'https://example.com/document.pdf',
		description: 'URL reference to the uploaded document',
		required: false,
	})
	@IsOptional()
	@IsString()
	documentUrl?: string;

	@ApiProperty({
		example: ClaimCategory.GENERAL,
		description: 'Category of the claim',
	})
	@IsNotEmpty()
	@IsEnum(ClaimCategory)
	category: ClaimCategory;

	/**
	 * Owner is resolved from auth token; do not send in payload.
	 */
	@ApiProperty({
		example: 1,
		description: 'Resolved from auth token (ignored if sent). Do not include in request body.',
		required: false,
		deprecated: true,
	})
	@IsOptional()
	@IsNumber()
	owner?: number;

	@ApiProperty({
		example: Currency.ZAR,
		description: 'Currency code for the claim amount',
		required: false,
	})
	@IsOptional()
	@IsEnum(Currency)
	currency?: Currency;
}
