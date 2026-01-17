import { IsOptional, IsString, IsBoolean, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVirtualCardDto {
	@ApiPropertyOptional({
		description: 'Card image URL',
		example: 'https://example.com/card-image.png'
	})
	@IsString()
	@IsOptional()
	cardImageUrl?: string;

	@ApiPropertyOptional({
		description: 'Logo URL',
		example: 'https://example.com/logo.png'
	})
	@IsString()
	@IsOptional()
	logoUrl?: string;

	@ApiPropertyOptional({
		description: 'Primary color (hex)',
		example: '#1F2937'
	})
	@IsString()
	@IsOptional()
	primaryColor?: string;

	@ApiPropertyOptional({
		description: 'Secondary color (hex)',
		example: '#FFFFFF'
	})
	@IsString()
	@IsOptional()
	secondaryColor?: string;

	@ApiPropertyOptional({
		description: 'Accent color (hex)',
		example: '#F59E0B'
	})
	@IsString()
	@IsOptional()
	accentColor?: string;

	@ApiPropertyOptional({
		description: 'Background pattern',
		example: 'gradient'
	})
	@IsString()
	@IsOptional()
	backgroundPattern?: string;

	@ApiPropertyOptional({
		description: 'Card style',
		example: 'modern'
	})
	@IsString()
	@IsOptional()
	cardStyle?: string;

	@ApiPropertyOptional({
		description: 'Show points on card',
		example: true
	})
	@IsBoolean()
	@IsOptional()
	showPoints?: boolean;

	@ApiPropertyOptional({
		description: 'Show tier on card',
		example: true
	})
	@IsBoolean()
	@IsOptional()
	showTier?: boolean;

	@ApiPropertyOptional({
		description: 'Show QR code on card',
		example: true
	})
	@IsBoolean()
	@IsOptional()
	showQRCode?: boolean;

	@ApiPropertyOptional({
		description: 'Show barcode on card',
		example: true
	})
	@IsBoolean()
	@IsOptional()
	showBarcode?: boolean;

	@ApiPropertyOptional({
		description: 'Barcode format (CODE128, EAN13, etc.)',
		example: 'CODE128'
	})
	@IsString()
	@IsOptional()
	barcodeFormat?: string;

	@ApiPropertyOptional({
		description: 'Custom fields',
		example: {}
	})
	@IsObject()
	@IsOptional()
	customFields?: {
		[key: string]: any;
	};
}
