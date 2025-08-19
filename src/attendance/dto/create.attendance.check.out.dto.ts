import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsDate, IsDecimal, IsObject, IsNotEmpty } from 'class-validator';

export class CreateCheckOutDto {
    @IsDate()
    @ApiProperty({
        type: Date,
        required: true,
        example: `${new Date()}`
    })
    checkOut: Date;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: 10
    })
    duration?: number;

    @IsString()
    @IsOptional()
    @ApiProperty({
        type: String,
        required: false,
        example: 'Notes for check-out'
    })
    checkOutNotes?: string;

    @IsDecimal()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: 40.7128
    })
    checkOutLatitude?: number;

    @IsDecimal()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: -74.0060
    })
    checkOutLongitude?: number;

    @IsNotEmpty()
    @IsObject()
    @ApiProperty({
        example: { uid: 1 },
        description: 'The owner reference code of the attendance check out'
    })
    owner: { uid: number };
} 
