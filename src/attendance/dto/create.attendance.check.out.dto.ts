import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsNumber, IsDate, IsDecimal, IsNotEmpty, ValidateNested } from 'class-validator';
import { OwnerUidDto } from '../../lib/dto/owner-uid.dto';

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

    @IsOptional()
    @ValidateNested()
    @Type(() => OwnerUidDto)
    @ApiProperty({
        type: OwnerUidDto,
        required: false,
        example: { uid: '1' },
        description:
            'Owner reference (user ref). Omit for self check-out; user is derived from the token. Required in consolidate mode.',
    })
    owner?: OwnerUidDto;
} 
