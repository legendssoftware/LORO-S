import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsNotEmpty } from 'class-validator';
import { AddressDto } from '../../clients/dto/create-client.dto';

export class CreateBranchDto {
	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'Branch Name',
		description: 'The name of the branch',
	})
	name: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'email/username.co.za',
		description: 'The email of the branch',
	})
	email: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Alias for the competitor',
		example: 'acme',
		required: false,
	})
	alias?: string;

	@ApiProperty({
		example: '0712345678',
		description: 'The phone number of the branch',
	})
	phone: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'https://example.com',
		description: 'The website of the branch',
	})
	website: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: 'Brandon N Nkawu',
		description: 'The contact person of the branch',
	})
	contactPerson: string;

	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: '1234567890',
		description: 'The reference code of the branch',
	})
	ref: string;

	@ValidateNested()
	@Type(() => AddressDto)
	@IsNotEmpty()
	@ApiProperty({
		description: 'The full address of the client including coordinates',
		type: AddressDto,
	})
	address: AddressDto;

	@ApiProperty({
		example: { uid: 1 },
		description: 'The reference code of the organisation',
	})
	organisation: { uid: number };
}
