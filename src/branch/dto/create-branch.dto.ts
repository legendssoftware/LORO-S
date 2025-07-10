import { ApiProperty } from "@nestjs/swagger";
import { ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { IsNotEmpty } from "class-validator";
import { AddressDto } from "../../clients/dto/create-client.dto";

export class CreateBranchDto {
    @ApiProperty({
        example: 'Branch Name',
        description: 'The name of the branch'
    })
    name: string;

    @ApiProperty({
        example: 'email/username.co.za',
        description: 'The email of the branch'
    })
    email: string;

    @ApiProperty({
        example: '0712345678',
        description: 'The phone number of the branch'
    })
    phone: string;

    @ApiProperty({
        example: 'https://example.com',
        description: 'The website of the branch'
    })
    website: string;

    @ApiProperty({
        example: 'Brandon N Nkawu',
        description: 'The contact person of the branch'
    })
    contactPerson: string;

    @ApiProperty({
        example: '1234567890',
        description: 'The reference code of the branch'
    })
    ref: string;

    @ValidateNested()
    @Type(() => AddressDto)
    @IsNotEmpty()
    @ApiProperty({
        description: 'The full address of the client including coordinates',
        type: AddressDto
    })
    address: AddressDto;

    @ApiProperty({
        example: { uid: 1 },
        description: 'The reference code of the organisation'
    })
    organisation: { uid: number };
}
