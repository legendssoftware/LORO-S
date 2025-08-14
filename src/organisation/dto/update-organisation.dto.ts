import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateOrganisationDto } from './create-organisation.dto';
import { ValidateNested } from 'class-validator';
import { IsString, IsEmail, IsUrl, IsOptional } from 'class-validator';
import { AddressDto } from '../../clients/dto/create-client.dto';
import { Type } from 'class-transformer';

export class UpdateOrganisationDto extends PartialType(CreateOrganisationDto) {
	@IsOptional()
	@IsString()
	@ApiProperty({
		example: 'Acme Inc.',
		description: 'The name of the organisation',
	})
	name?: string;

	@ValidateNested()
	@Type(() => AddressDto)
	@IsOptional()
	@ApiProperty({
		description: 'The full address of the organisation including coordinates',
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

	@IsOptional()
	@IsEmail()
	@ApiProperty({
		example: 'email/username.co.za',
		description: 'The email of the organisation',
	})
	email: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		example: '123-456-7890',
		description: 'The phone number of the organisation',
	})
	phone?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		example: 'Brandon Nkawu',
		description: 'The contact person of the organisation',
	})
	contactPerson: string;

	@IsOptional()
	@IsUrl()
	@ApiProperty({
		example: 'https://www.acme.com',
		description: 'The website of the organisation',
	})
	website: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		example: 'https://www.acme.com/logo.png',
		description: 'The logo of the organisation',
	})
	logo?: string;
}
