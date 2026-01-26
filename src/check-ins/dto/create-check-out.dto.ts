import { IsNotEmpty, IsObject, IsString, IsOptional } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateCheckOutDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The photo of the check-out',
        example: `${new Date()}`
    })
    checkOutTime: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The location of the check-out',
        example: '-36.3434314, 149.8488864'
    })
    checkOutLocation: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'The saved check out photo tag name i.e check-out.jpg',
        example: 'check-out.jpg'
    })
    checkOutPhoto: string;

    /**
     * Owner resolved from auth token (clerkUserId); no owner/uid in DTO.
     */

    @IsNotEmpty()
    @IsObject()
    @ApiProperty({
        example: {
            uid: 1
        },
        description: 'The branch reference code of the attendance check in'
    })
    branch: { uid: number };

    @IsOptional()
    @IsObject()
    @ApiProperty({
        example: {
            uid: 1
        },
        description: 'The client associated with this check-out (optional, can be updated)',
        required: false
    })
    client?: { uid: number };

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Notes for the check-out',
        example: 'Visit completed successfully',
        required: false
    })
    notes?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Resolution or outcome of the visit',
        example: 'Issue resolved, customer satisfied',
        required: false
    })
    resolution?: string;
}