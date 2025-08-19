import { IsDate, IsOptional, IsString } from 'class-validator';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { IsNumber } from 'class-validator';
import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAttendanceDto {
    @IsEnum(AttendanceStatus)
    @IsOptional()
    @ApiProperty({
        enum: AttendanceStatus,
        required: false,
        example: AttendanceStatus.PRESENT,
        default: AttendanceStatus.PRESENT,
        description: 'Attendance status of the employee (PRESENT, ABSENT, LATE, etc)'
    })
    status?: AttendanceStatus;

    @IsDate()
    @IsOptional()
    @ApiProperty({
        type: Date,
        required: false,
        example: `${new Date()}`,
        description: 'Date and time when employee checked in'
    })
    checkIn?: Date;

    @IsDate()
    @IsOptional()
    @ApiProperty({
        type: Date,
        required: false,
        example: `${new Date()}`,
        description: 'Date and time when employee checked out'
    })
    checkOut?: Date;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: 10,
        description: 'Duration of attendance in minutes'
    })
    duration?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: 40.7128,
        description: 'Latitude coordinate of check-in location'
    })
    checkInLatitude?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: -74.0060,
        description: 'Longitude coordinate of check-in location'
    })
    checkInLongitude?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: 40.7128,
        description: 'Latitude coordinate of check-out location'
    })
    checkOutLatitude?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: -74.0060,
        description: 'Longitude coordinate of check-out location'
    })
    checkOutLongitude?: number;

    @IsString()
    @IsOptional()
    @ApiProperty({
        type: String,
        required: false,
        example: 'Notes',
        description: 'Additional notes or comments recorded during check-out'
    })
    checkOutNotes?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        type: String,
        required: false,
        example: { uid: 1 },
        description: 'Reference code to identify the employee'
    })
    owner?: { uid: number };
}
