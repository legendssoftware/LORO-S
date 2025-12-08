import { IsOptional, IsObject, IsString, IsNumber } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateVisitDetailsDto {
    @IsNumber()
    @ApiProperty({
        description: 'The check-in ID to update',
        example: 1
    })
    checkInId: number;

    @IsOptional()
    @IsObject()
    @ApiProperty({
        example: {
            uid: 1
        },
        description: 'The client associated with this visit (optional)',
        required: false
    })
    client?: { uid: number };

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Notes for the visit',
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
