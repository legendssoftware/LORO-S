import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsBoolean, IsOptional, IsEmail, IsDate, IsEnum, IsObject } from "class-validator";
import { Department } from "../../lib/enums/user.enums";

export class CreateUserEmploymentProfileDto {
    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Branch reference ID',
        example: 'BRANCH123',
        required: false
    })
    branchref?: string;

    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'User reference object',
        example: { uid: 1 },
        required: false
    })
    owner?: { uid: number };

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