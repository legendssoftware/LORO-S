import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { AddressDto } from '../../clients/dto/create-client.dto';

export class CreateOrganisationDto {
	@IsNotEmpty()
	@IsString()
	@ApiProperty({
		example: 'ACME Corporation, Inc.',
		description: 'Official registered business name of the organisation',
	})
	name: string;

	@ValidateNested()
	@Type(() => AddressDto)
	@IsNotEmpty()
	@ApiProperty({
		description: 'Physical address of the organisation headquarters including geolocation coordinates',
		type: AddressDto,
	})
	address: AddressDto;

	@IsOptional()
	@IsString()
	@ApiProperty({
		example: 'acme',
		description: 'Alias for the organisation',
	})
	alias?: string;

	@IsNotEmpty()
	@IsEmail()
	@ApiProperty({
		example: 'contact@acmecorp.com',
		description: 'Primary contact email address for the organisation (used for official communications)',
	})
	email: string;

	@IsNotEmpty()
	@IsString()
	@ApiProperty({
		example: '+1 (555) 123-4567',
		description: 'Main business phone number with country code',
	})
	phone: string;

	@IsNotEmpty()
	@IsString()
	@ApiProperty({
		example: 'Jane Smith, Chief Operations Officer',
		description: 'Primary point of contact including name and position',
	})
	contactPerson: string;

	@IsNotEmpty()
	@IsUrl()
	@ApiProperty({
		example: 'https://www.acmecorp.com',
		description: 'Official website URL of the organisation (must include https://)',
	})
	website: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		example: 'https://storage.googleapis.com/acmecorp-assets/logo-full.png',
		description: 'URL to high-resolution organization logo (recommended: SVG or PNG with transparency)',
	})
	logo?: string;
}
