import { PartialType, ApiProperty } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { Gender } from '../../lib/enums/gender.enums';
import { AccessLevel } from '../../lib/enums/user.enums';
import { Department } from '../../lib/enums/user.enums';
import { AccountStatus } from '../../lib/enums/status.enums';
import { CreateUserProfileDto } from './create-user-profile.dto';
import { CreateUserEmploymentProfileDto } from './create-user-employment-profile.dto';
import { IsBoolean, IsDate, IsEmail, IsEnum, IsObject, IsOptional, IsString, IsNumber, IsDateString } from 'class-validator';

export class UpdateUserProfileDto extends CreateUserProfileDto {
	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Height of the user',
		example: '180cm',
		required: false
	})
	height?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Weight of the user',
		example: '75kg',
		required: false
	})
	weight?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Hair color of the user',
		example: 'Brown',
		required: false
	})
	hairColor?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Eye color of the user',
		example: 'Blue',
		required: false
	})
	eyeColor?: string;

	@IsOptional()
	@IsEnum(Gender)
	@ApiProperty({
		description: 'Gender of the user',
		enum: Gender,
		example: Gender.MALE,
		required: false
	})
	gender?: Gender;

	@IsOptional()
	@IsDate()
	@ApiProperty({
		description: 'Date of birth of the user',
		example: '1990-01-01',
		required: false
	})
	dateOfBirth?: Date;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Address of the user',
		example: '123 Main Street',
		required: false
	})
	address?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'City of the user',
		example: 'Cape Town',
		required: false
	})
	city?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Country of the user',
		example: 'South Africa',
		required: false
	})
	country?: string;
}

export class UpdateUserEmploymentProfileDto extends CreateUserEmploymentProfileDto {
	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Branch reference ID',
		example: 'BRANCH123',
		required: false
	})
	branchref?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Position in the company',
		example: 'Senior Software Engineer',
		required: false
	})
	position?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Department name',
		example: 'Engineering',
		required: false
	})
	department?: string;

	@IsOptional()
	@IsDate()
	@ApiProperty({
		description: 'Employment start date',
		example: '2024-01-01',
		required: false
	})
	startDate?: Date;

	@IsOptional()
	@IsDate()
	@ApiProperty({
		description: 'Employment end date',
		example: '2024-12-31',
		required: false
	})
	endDate?: Date;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether currently employed',
		example: true,
		default: true,
		required: false
	})
	isCurrentlyEmployed?: boolean;

	@IsOptional()
	@IsEmail()
	@ApiProperty({
		description: 'Work email address',
		example: 'brandon.work@loro.co.za',
		required: false
	})
	email?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Work contact number',
		example: '+27 64 123 4567',
		required: false
	})
	contactNumber?: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Username for authentication',
		example: 'brandon123',
		required: false
	})
	username?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'First name of the user',
		example: 'Brandon',
		required: false
	})
	name?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Surname of the user',
		example: 'Nkawu',
		required: false
	})
	surname?: string;

	@IsOptional()
	@IsEmail()
	@ApiProperty({
		description: 'Email address of the user',
		example: 'brandon.updated@loro.co.za',
		required: false
	})
	email?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Phone number of the user',
		example: '+27 64 123 4567',
		required: false
	})
	phone?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Profile photo URL of the user',
		example: 'https://example.com/updated-photo.jpg',
		required: false
	})
	photoURL?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Business card URL of the user',
		example: 'https://example.com/updated-businesscard.jpg',
		required: false
	})
	businesscardURL?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Avatar URL of the user for enhanced profile display',
		example: 'https://example.com/updated-avatar.jpg',
		required: false
	})
	avatar?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Role of the user',
		example: 'manager',
		required: false
	})
	role?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Status of the user account',
		example: 'active',
		required: false
	})
	status?: string;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Department ID of the user',
		example: 2,
		required: false
	})
	departmentId?: number;

	@IsOptional()
	@IsEnum(AccessLevel)
	@ApiProperty({
		description: 'Access level of the user',
		enum: AccessLevel,
		example: AccessLevel.MANAGER,
		required: false
	})
	accessLevel?: AccessLevel;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Organization reference ID',
		example: 'ORG456',
		required: false
	})
	organisationRef?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Unique reference code for the user',
		example: 'USR789012',
		required: false
	})
	userref?: string;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'HR system ID for backward compatibility',
		example: 54321,
		required: false
	})
	hrID?: number;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Email verification token',
		example: 'updated-token-123',
		required: false
	})
	verificationToken?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Password reset token',
		example: 'reset-token-456',
		required: false
	})
	resetToken?: string;

	@IsOptional()
	@IsDateString()
	@ApiProperty({
		description: 'Token expiration date',
		example: '2024-12-31T23:59:59Z',
		required: false
	})
	tokenExpires?: Date;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Expo push notification token',
		example: 'ExponentPushToken[updated-token]',
		required: false
	})
	expoPushToken?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Device ID for push notifications',
		example: 'device456def',
		required: false
	})
	deviceId?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Platform type',
		example: 'android',
		enum: ['ios', 'android'],
		required: false
	})
	platform?: string;

	@IsOptional()
	@IsDateString()
	@ApiProperty({
		description: 'Last push token update timestamp',
		example: '2024-02-01T00:00:00Z',
		required: false
	})
	pushTokenUpdatedAt?: Date;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Whether the user is deleted',
		example: false,
		required: false
	})
	isDeleted?: boolean;

	@IsOptional()
	@IsObject()
	@ApiProperty({
		description: 'Organization object reference',
		example: { uid: 2 },
		required: false
	})
	organisation?: { uid: number };

	@IsOptional()
	@IsObject()
	@ApiProperty({
		description: 'Branch object reference',
		example: { uid: 3 },
		required: false
	})
	branch?: { uid: number };

	@IsOptional()
	@IsDate()
	@ApiProperty({
		description: 'Updated date',
		example: '2024-01-01T00:00:00Z',
		required: false
	})
	updatedAt?: Date;

	@IsOptional()
	@IsDate()
	@ApiProperty({
		description: 'Deleted date',
		example: '2024-01-01T00:00:00Z',
		required: false
	})
	deletedAt?: Date;

	@IsOptional()
	@ApiProperty({
		description: 'User profile information',
		type: () => UpdateUserProfileDto,
		required: false
	})
	profile?: UpdateUserProfileDto;

	@IsOptional()
	@ApiProperty({
		description: 'User employment profile information',
		type: () => UpdateUserEmploymentProfileDto,
		required: false
	})
	employmentProfile?: UpdateUserEmploymentProfileDto;

	@IsOptional()
	@IsNumber({}, { each: true })
	@ApiProperty({
		description: 'Array of client UIDs that this user has access to',
		example: [1, 2, 3, 4],
		type: [Number],
		required: false
	})
	assignedClientIds?: number[];

	@IsOptional()
	@IsNumber({}, { each: true })
	@ApiProperty({
		description: 'Array of branch UIDs that this user manages',
		example: [1, 2],
		type: [Number],
		required: false
	})
	managedBranches?: number[];

	@IsOptional()
	@IsNumber({}, { each: true })
	@ApiProperty({
		description: 'Array of user UIDs that this user manages as staff',
		example: [5, 6, 7],
		type: [Number],
		required: false
	})
	managedStaff?: number[];

	@IsOptional()
	@IsNumber({}, { each: true })
	@ApiProperty({
		description: 'Array of IoT device IDs (doors) that this user manages',
		example: [1, 2, 3],
		type: [Number],
		required: false
	})
	managedDoors?: number[];
}
