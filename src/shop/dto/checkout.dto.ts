import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, ValidateNested, IsNumber, IsString, IsEnum, IsOptional, IsEmail, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export enum PurchaseMode {
	ITEM = 'item',
	PALETTE = 'palette',
}

export class OrderItemDto {
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
		description: 'Quantity of the product/palette',
		example: 1,
	})
	quantity: number;

	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Unit price for this item (based on purchase mode)',
		example: 4.99,
	})
	unitPrice: number;

	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Total price for this item (unitPrice * quantity)',
		example: 4.99,
	})
	totalPrice: number;

	@IsEnum(PurchaseMode)
	@IsNotEmpty()
	@ApiProperty({
		description: 'Purchase mode - individual item or palette',
		enum: PurchaseMode,
		example: PurchaseMode.ITEM,
	})
	purchaseMode: PurchaseMode;

	@IsNumber()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Number of individual items per unit (1 for items, palette count for palettes)',
		example: 1,
	})
	itemsPerUnit: number;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'SKU used for this purchase (item SKU or palette SKU)',
		example: 'ABC-DEF-001-000001',
		required: false,
	})
	sku?: string;
}

export class CheckoutDto {
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => OrderItemDto)
	@ApiProperty({
		description: 'Array of order items',
		type: [OrderItemDto],
	})
	items: OrderItemDto[];

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		description: 'ref code of the client',
		example: { uid: 1 },
	})
	client: { uid: number };

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Total amount for the order',
		example: '123.45',
	})
	totalAmount: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		description: 'Total number of individual items',
		example: '15',
	})
	totalItems: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Promotional code if applied',
		example: 'SUMMER2024',
		required: false,
	})
	promoCode?: string;

	@IsEmail()
	@IsOptional()
	@ApiProperty({
		description: 'Optional email address to send the quotation to',
		example: 'customer@example.com',
		required: false,
	})
	recipientEmail?: string;

	@IsOptional()
	@ApiProperty({
		description: 'Optional project to associate with this quotation',
		example: { uid: 42 },
		required: false,
	})
	project?: { uid: number };

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Document type (quotation, order, purchase, refund, credit_note, invoice)',
		example: 'quotation',
		required: false,
	})
	documentType?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Delivery method (collect or deliver)',
		example: 'collect',
		required: false,
	})
	deliveryMethod?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Delivery address if delivery method is deliver',
		example: '123 Main St, City, Country',
		required: false,
	})
	deliveryAddress?: string;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Settlement discount amount',
		example: 0,
		required: false,
	})
	settlementDiscount?: number;
}
