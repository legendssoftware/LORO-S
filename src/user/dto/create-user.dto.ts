import { ApiProperty } from "@nestjs/swagger";
import { AccessLevel } from "../../lib/enums/user.enums";
import { AccountStatus } from "../../lib/enums/status.enums";
import { CreateUserProfileDto } from './create-user-profile.dto';
import { CreateUserEmploymentProfileDto } from './create-user-employment-profile.dto';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsBoolean, IsNumber } from "class-validator";

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
        description: 'The name of the user',
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
        description: 'The email of the user',
        example: 'brandon@loro.co.za',
    })
    email: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The phone number of the user',
        example: '+27 64 123 4567',
    })
    phone: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The photo URL of the user',
        example: 'https://example.com/photo.jpg',
    })
    photoURL: string;

    @IsOptional()
    @IsEnum(AccessLevel)
    @ApiProperty({
        description: 'The access level of the user',
        enum: AccessLevel,
        example: AccessLevel.USER,
        default: AccessLevel.USER,
    })
    accessLevel?: AccessLevel;

    @IsOptional()
    @IsEnum(AccountStatus)
    @ApiProperty({
        description: 'The status of the user',
        enum: AccountStatus,
        example: AccountStatus.ACTIVE,
        default: AccountStatus.ACTIVE,
    })
    status?: AccountStatus;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The unique reference code for the user',
        example: 'USR123456',
    })
    userref: string;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'HR system ID for backward compatibility with legacy HR system',
        example: 12345,
        required: false,
    })
    hrID?: number;

    @IsOptional()
    @ApiProperty({
        description: 'User profile information',
        type: () => CreateUserProfileDto
    })
    profile?: CreateUserProfileDto;

    @IsOptional()
    @ApiProperty({
        description: 'User employment profile information',
        type: () => CreateUserEmploymentProfileDto
    })
    employmentProfile?: CreateUserEmploymentProfileDto;
}
