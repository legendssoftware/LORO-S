import { IsNotEmpty, IsObject, IsString, IsOptional, IsNumber, IsEnum } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Address } from "src/lib/interfaces/address.interface";
import { OrderStatus } from "src/lib/enums/status.enums";
import { Industry } from "src/lib/enums/lead.enums";

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
     * Branch is optional - visits use org and user only.
     */

    @IsOptional()
    @IsObject()
    @ApiProperty({
        example: {
            uid: 1
        },
        description: 'The branch reference code of the attendance check in (optional - visits use org and user only)',
        required: false
    })
    branch?: { uid: number };

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

    // Contact Information Fields (can be updated during check-out)
    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Full name of the person contacted',
        example: 'John Doe',
        required: false
    })
    contactFullName?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Image URL of the person contacted',
        example: 'https://example.com/image.jpg',
        required: false
    })
    contactImage?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Cell phone number of the person contacted',
        example: '+27123456789',
        required: false
    })
    contactCellPhone?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Landline phone number of the person contacted',
        example: '+27123456780',
        required: false
    })
    contactLandline?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Email address of the person contacted',
        example: 'john.doe@example.com',
        required: false
    })
    contactEmail?: string;

    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'Address of the person contacted',
        required: false
    })
    contactAddress?: Address;

    // Company and Business Information Fields
    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Company name (separate from client relation)',
        example: 'Acme Corporation',
        required: false
    })
    companyName?: string;

    @IsOptional()
    @IsEnum(Industry)
    @ApiProperty({
        description: 'Type of business/industry',
        enum: Industry,
        example: Industry.TECHNOLOGY,
        required: false
    })
    businessType?: Industry;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Position of the person seen',
        example: 'Sales Manager',
        required: false
    })
    personSeenPosition?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Meeting link (URL)',
        example: 'https://meet.google.com/abc-defg-hij',
        required: false
    })
    meetingLink?: string;

    // Sales and Quotation Fields
    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Amount of sales made during the visit',
        example: 1500.00,
        required: false
    })
    salesValue?: number;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Quotation number if quotation was created',
        example: 'QT-2024-001',
        required: false
    })
    quotationNumber?: string;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Quotation UID if quotation was created',
        example: 123,
        required: false
    })
    quotationUid?: number;

    @IsOptional()
    @IsEnum(OrderStatus)
    @ApiProperty({
        description: 'Status of the quotation',
        enum: OrderStatus,
        example: OrderStatus.PENDING_CLIENT,
        required: false
    })
    quotationStatus?: OrderStatus;

    // New check-in enhancement fields
    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Method of contact used during the visit',
        example: 'Phone Call',
        enum: ['Phone Call', 'Email', 'In-Person Visit', 'Video Call', 'WhatsApp', 'Other'],
        required: false
    })
    methodOfContact?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Type of building visited',
        example: 'Residential',
        enum: ['Residential', 'Commercial', 'Industrial', 'Mixed Use', 'Other'],
        required: false
    })
    buildingType?: string;

    @IsOptional()
    @ApiProperty({
        description: 'Whether contact was made during the visit',
        example: true,
        required: false
    })
    contactMade?: boolean;
}