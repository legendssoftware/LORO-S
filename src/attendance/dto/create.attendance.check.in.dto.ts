import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { IsEnum, IsOptional, IsString, IsNumber, IsDate, IsObject, ValidateNested } from 'class-validator';
import { OwnerUidDto } from '../../lib/dto/owner-uid.dto';

export class CreateCheckInDto {
    @IsEnum(AttendanceStatus)
    @IsOptional()
    @ApiProperty({
        enum: AttendanceStatus,
        required: false,
        example: AttendanceStatus.PRESENT,
        default: AttendanceStatus.PRESENT
    })
    status?: AttendanceStatus;

    @IsDate()
    @ApiProperty({
        type: Date,
        required: true,
        example: `${new Date()}`
    })
    checkIn: Date;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: 40.7128
    })
    checkInLatitude?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: -74.0060
    })
    checkInLongitude?: number;

    @IsString()
    @IsOptional()
    @ApiProperty({
        type: String,
        required: false,
        example: 'Notes'
    })
    checkInNotes?: string;

    @IsOptional()
    @IsObject()
    @ApiProperty({
        required: false,
        example: { uid: 1 },
        description: 'Optional branch reference for the attendance check-in. Omit when user has no branch; org is sufficient.'
    })
    branch?: { uid: number };

    @IsOptional()
    @ValidateNested()
    @Type(() => OwnerUidDto)
    @ApiProperty({
        type: OwnerUidDto,
        required: false,
        example: { uid: '1' },
        description:
            'Owner reference (user ref). Omit for self check-in; user is derived from the token. Required in consolidate mode.',
    })
    owner?: OwnerUidDto;
} 
