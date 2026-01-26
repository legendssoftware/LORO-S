import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, ValidateNested, IsNumber, IsString, IsEnum, IsOptional, IsEmail, IsBoolean } from 'class-validator';
import { OwnerUidDto } from '../../lib/dto/owner-uid.dto';
import { Type } from 'class-transformer';
import { PriceListType } from '../../lib/enums/product.enums';

export class BlankQuotationItemDto {
	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'The product ID',
		example: 39,
	})
	uid: number;

	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Quantity of the product',
		example: 1,
	})
	quantity: number;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Additional notes for this item',
		example: 'Customer specific requirements',
		required: false,
	})
	notes?: string;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Whether to include this item in the quotation',
		example: true,
		required: false,
	})
	included?: boolean;
}

export class CreateBlankQuotationDto {
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => BlankQuotationItemDto)
	@ApiProperty({
		description: 'Array of products to include in the blank quotation',
		type: [BlankQuotationItemDto],
	})
	items: BlankQuotationItemDto[];

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Client reference',
		example: { uid: 1 },
	})
	client: { uid: number };

	@IsNotEmpty()
	@ValidateNested()
	@Type(() => OwnerUidDto)
	@ApiProperty({
		type: OwnerUidDto,
		description: 'Owner/creator reference (user ref as string)',
		example: { uid: '1' },
	})
	owner: OwnerUidDto;

	@IsEnum(PriceListType)
	@IsNotEmpty()
	@ApiProperty({
		description: 'Price list type to use for the quotation',
		enum: PriceListType,
		example: PriceListType.PREMIUM,
	})
	priceListType: PriceListType;

	@IsEmail()
	@IsOptional()
	@ApiProperty({
		description: 'Optional email address to send the quotation to',
		example: 'customer@example.com',
		required: false,
	})
	recipientEmail?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Optional title for the quotation',
		example: 'Special Pricing Request',
		required: false,
	})
	title?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Optional description or notes for the quotation',
		example: 'Quotation for bulk purchase discussion',
		required: false,
	})
	description?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Promotional code if applicable',
		example: 'BULK2024',
		required: false,
	})
	promoCode?: string;
} 