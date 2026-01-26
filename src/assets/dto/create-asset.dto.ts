import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsDate, IsNotEmpty, IsObject, IsString, ValidateNested } from "class-validator";
import { OwnerUidDto } from "../../lib/dto/owner-uid.dto";

export class CreateAssetDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        example: 'Dell',
        description: 'The brand of the asset'
    })
    brand: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        example: '1234567890',
        description: 'The serial number of the asset'
    })
    serialNumber: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        example: '1234567890',
        description: 'The model number of the asset'
    })
    modelNumber: string;

    @IsNotEmpty()
    @IsDate()
    @ApiProperty({
        example: `${new Date()}`,
        description: 'The purchase date of the asset'
    })
    purchaseDate: Date;

    @IsNotEmpty()
    @IsBoolean()
    @ApiProperty({
        example: true,
        description: 'Whether the asset has insurance'
    })
    hasInsurance: boolean;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        example: 'ABC Insurance',
        description: 'The insurance provider of the asset'
    })
    insuranceProvider: string;

    @IsNotEmpty()
    @IsDate()
    @ApiProperty({
        example: `${new Date()}`,
        description: 'The insurance expiry date of the asset'
    })
    insuranceExpiryDate: Date;

    @IsNotEmpty()
    @ValidateNested()
    @Type(() => OwnerUidDto)
    @ApiProperty({
        type: OwnerUidDto,
        example: { uid: '1' },
        description: 'The owner reference (user ref) of the asset (string)',
    })
    owner: OwnerUidDto;

    @IsNotEmpty()
    @IsObject()
    @ApiProperty({
        example: { uid: 1 },
        description: 'The branch reference code of the asset'
    })
    branch: { uid: number };
}
