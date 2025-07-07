import { ApiProperty } from "@nestjs/swagger";
import { AccessLevel } from "../../lib/enums/user.enums";
import { AccountStatus } from "../../lib/enums/status.enums";
import { CreateUserProfileDto } from './create-user-profile.dto';
import { CreateUserEmploymentProfileDto } from './create-user-employment-profile.dto';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsBoolean, IsNumber, IsDateString, IsObject } from "class-validator";

export class CreateUserDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The username for authentication',
        example: 'brandon123',
    })
    username: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The password for authentication',
        example: 'securePassword123',
    })
    password: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The first name of the user',
        example: 'Brandon',
    })
    name: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The surname of the user',
        example: 'Nkawu',
    })
    surname: string;

    @IsNotEmpty()
    @IsEmail()
    @ApiProperty({
        description: 'The email address of the user',
        example: 'brandon@loro.co.za',
    })
    email: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The phone number of the user',
        example: '+27 64 123 4567',
        required: false,
    })
    phone?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The profile photo URL of the user',
        example: 'https://example.com/photo.jpg',
        required: false,
    })
    photoURL?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The business card URL of the user',
        example: 'https://example.com/businesscard.jpg',
        required: false,
    })
    businesscardURL?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The role of the user',
        example: 'user',
        default: 'user',
        required: false,
    })
    role?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The status of the user account',
        example: 'active',
        default: 'active',
        required: false,
    })
    status?: string;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'The department ID of the user',
        example: 1,
        required: false,
    })
    departmentId?: number;

    @IsOptional()
    @IsEnum(AccessLevel)
    @ApiProperty({
        description: 'The access level of the user',
        enum: AccessLevel,
        example: AccessLevel.USER,
        default: AccessLevel.USER,
        required: false,
    })
    accessLevel?: AccessLevel;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The organization reference ID',
        example: 'ORG123',
        required: false,
    })
    organisationRef?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The unique reference code for the user',
        example: 'USR123456',
        required: false,
    })
    userref?: string;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'HR system ID for backward compatibility with legacy HR system',
        example: 12345,
        required: false,
    })
    hrID?: number;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Email verification token',
        example: 'abc123def456',
        required: false,
    })
    verificationToken?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Password reset token',
        example: 'xyz789uvw012',
        required: false,
    })
    resetToken?: string;

    @IsOptional()
    @IsDateString()
    @ApiProperty({
        description: 'Token expiration date',
        example: '2024-12-31T23:59:59Z',
        required: false,
    })
    tokenExpires?: Date;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Expo push notification token',
        example: 'ExponentPushToken[abc123def456]',
        required: false,
    })
    expoPushToken?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Device ID for push notifications',
        example: 'device123abc',
        required: false,
    })
    deviceId?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Platform type',
        example: 'ios',
        enum: ['ios', 'android'],
        required: false,
    })
    platform?: string;

    @IsOptional()
    @IsDateString()
    @ApiProperty({
        description: 'Last push token update timestamp',
        example: '2024-01-01T00:00:00Z',
        required: false,
    })
    pushTokenUpdatedAt?: Date;

    @IsOptional()
    @IsBoolean()
    @ApiProperty({
        description: 'Whether the user is deleted',
        example: false,
        default: false,
        required: false,
    })
    isDeleted?: boolean;

    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'Organization object reference',
        example: { uid: 1 },
        required: false,
    })
    organisation?: { uid: number };

    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'Branch object reference',
        example: { uid: 1 },
        required: false,
    })
    branch?: { uid: number };

    @IsOptional()
    @ApiProperty({
        description: 'User profile information',
        type: () => CreateUserProfileDto,
        required: false,
    })
    profile?: CreateUserProfileDto;

    @IsOptional()
    @ApiProperty({
        description: 'User employment profile information',
        type: () => CreateUserEmploymentProfileDto,
        required: false,
    })
    employmentProfile?: CreateUserEmploymentProfileDto;
}
