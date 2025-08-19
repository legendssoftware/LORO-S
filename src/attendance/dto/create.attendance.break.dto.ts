import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsNumber, IsObject, IsNotEmpty } from 'class-validator';

export class CreateBreakDto {
    @IsBoolean()
    @IsNotEmpty()
    @ApiProperty({
        type: Boolean,
        required: true,
        example: true,
        description: 'True if starting a break, false if ending a break'
    })
    isStartingBreak: boolean;

    @IsString()
    @IsOptional()
    @ApiProperty({
        type: String,
        required: false,
        example: 'Taking lunch break'
    })
    breakNotes?: string;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: 40.7128
    })
    breakLatitude?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        type: Number,
        required: false,
        example: -74.0060
    })
    breakLongitude?: number;

    @IsNotEmpty()
    @IsObject()
    @ApiProperty({
        example: { uid: 1 },
        description: 'The owner reference code of the break action'
    })
    owner: { uid: number };
} 