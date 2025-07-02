import { PartialType, ApiProperty } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { Gender } from '../../lib/enums/gender.enums';
import { AccessLevel } from '../../lib/enums/user.enums';
import { Department } from '../../lib/enums/user.enums';
import { AccountStatus } from '../../lib/enums/status.enums';
import { CreateUserProfileDto } from './create-user-profile.dto';
import { CreateUserEmploymentProfileDto } from './create-user-employment-profile.dto';
import { IsBoolean, IsDate, IsEmail, IsEnum, IsObject, IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateUserProfileDto extends CreateUserProfileDto {
	@IsOptional()
	@IsString()
	height?: string;

	@IsOptional()
	@IsString()
	weight?: string;

	@IsOptional()
	@IsString()
	hairColor?: string;

	@IsOptional()
	@IsString()
	eyeColor?: string;

	@IsOptional()
	@IsEnum(Gender)
	gender?: Gender;

	@IsOptional()
	@IsDate()
	dateOfBirth?: Date;

	@IsOptional()
	@IsString()
	address?: string;

	@IsOptional()
	@IsString()
	city?: string;

	@IsOptional()
	@IsString()
	country?: string;
}

export class UpdateUserEmploymentProfileDto extends CreateUserEmploymentProfileDto {
	@IsOptional()
	@IsObject()
	branchref?: { uid: number };

	@IsOptional()
	@IsObject()
	position?: string;

	@IsOptional()
	@IsEnum(Department)
	department?: Department;

	@IsOptional()
	@IsDate()
	startDate?: Date;

	@IsOptional()
	@IsDate()
	endDate?: Date;

	@IsOptional()
	@IsBoolean()
	isCurrentlyEmployed?: boolean;

	@IsOptional()
	@IsEmail()
	email?: string;

	@IsOptional()
	@IsString()
	contactNumber?: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
	@IsOptional()
	@IsString()
	name?: string;

	@IsOptional()
	@IsString()
	surname?: string;

	@IsOptional()
	@IsString()
	email?: string;

	@IsOptional()
	@IsString()
	phone?: string;

	@IsOptional()
	@IsString()
	photoURL?: string;

	@IsOptional()
	@IsEnum(AccessLevel)
	accessLevel?: AccessLevel;

	@IsOptional()
	@IsDate()
	updatedAt?: Date;

	@IsOptional()
	@IsDate()
	deletedAt?: Date;

	@IsOptional()
	@IsEnum(AccountStatus)
	status?: AccountStatus;

	@IsOptional()
	@IsString()
	username?: string;

	@IsOptional()
	@IsString()
	password?: string;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'HR system ID for backward compatibility with legacy HR system',
		example: 12345,
		required: false,
	})
	hrID?: number;

	@IsOptional()
	profile?: UpdateUserProfileDto;

	@IsOptional()
	employmentProfile?: UpdateUserEmploymentProfileDto;
}
