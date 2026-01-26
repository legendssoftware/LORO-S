import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsNumber, IsObject, IsNotEmpty, ValidateNested } from 'class-validator';
import { OwnerUidDto } from '../../lib/dto/owner-uid.dto';

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

    @IsOptional()
    @ValidateNested()
    @Type(() => OwnerUidDto)
    @ApiProperty({
        type: OwnerUidDto,
        required: false,
        example: { uid: '1' },
        description:
            'Owner reference (user ref). Omit for self-service break; user is derived from the token.',
    })
    owner?: OwnerUidDto;
} 