import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsObject, IsOptional, IsEnum, IsNumber, IsArray, IsDate } from "class-validator";
import { Type } from "class-transformer";
import { JournalStatus, JournalType, InspectionRating, InspectionFormData } from "src/lib/enums/journal.enums";

/**
 * Owner is resolved from auth token (clerkUserId); no owner/uid in DTO.
 */
export class CreateJournalDto {
    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Client reference number',
        example: 'CLT123456',
        required: false
    })
    clientRef?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'URL to the journal file',
        example: 'https://storage.example.com/journals/file123.pdf',
        required: false
    })
    fileURL?: string;

    @IsOptional()
    @IsObject()
    @ApiProperty({
        example: { uid: 1 },
        description: 'The branch reference code of the journal',
        required: false
    })
    branch?: { uid: number };

    @IsOptional()
    @IsObject()
    @ApiProperty({
        example: { uid: 1 },
        description: 'The organisation reference code of the journal',
        required: false
    })
    organisation?: { uid: number };

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'The comments of the journal',
        example: 'This is a comment',
        required: false
    })
    comments?: string;

    @IsOptional()
    @IsEnum(JournalStatus)
    @ApiProperty({
        description: 'Journal status',
        enum: JournalStatus,
        default: JournalStatus.PENDING_REVIEW,
        example: JournalStatus.PENDING_REVIEW,
        required: false
    })
    status?: JournalStatus;

    @IsOptional()
    @IsEnum(JournalType)
    @ApiProperty({
        description: 'Journal type',
        enum: JournalType,
        default: JournalType.GENERAL,
        example: JournalType.GENERAL,
        required: false
    })
    type?: JournalType;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Journal title',
        example: 'Store Inspection Report',
        required: false
    })
    title?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Journal description',
        example: 'Comprehensive store inspection covering all areas',
        required: false
    })
    description?: string;

    // Inspection-specific fields
    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'Inspection form data structure',
        required: false,
        example: {
            categories: [
                {
                    id: 'cashier',
                    name: 'Cashier & Checkout Area',
                    items: [
                        {
                            id: 'pos_system',
                            name: 'POS system functionality',
                            score: 4,
                            notes: 'Working well',
                            required: true
                        }
                    ]
                }
            ]
        }
    })
    inspectionData?: InspectionFormData;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Total score achieved',
        example: 85.5,
        required: false
    })
    totalScore?: number;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Maximum possible score',
        example: 100,
        required: false
    })
    maxScore?: number;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Percentage score',
        example: 85.5,
        required: false
    })
    percentage?: number;

    @IsOptional()
    @IsEnum(InspectionRating)
    @ApiProperty({
        description: 'Overall inspection rating',
        enum: InspectionRating,
        required: false
    })
    overallRating?: InspectionRating;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Inspector comments',
        example: 'Overall performance is good with some areas for improvement',
        required: false
    })
    inspectorComments?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Store manager signature',
        example: 'John Doe',
        required: false
    })
    storeManagerSignature?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'QC inspector signature',
        example: 'Jane Smith',
        required: false
    })
    qcInspectorSignature?: string;

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    @ApiProperty({
        description: 'Inspection date',
        example: '2025-09-18T12:00:00Z',
        required: false
    })
    inspectionDate?: Date;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Inspection location',
        example: 'Main Store - Johannesburg',
        required: false
    })
    inspectionLocation?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @ApiProperty({
        description: 'Array of attachment file URLs',
        example: ['https://storage.example.com/attachments/photo1.jpg'],
        required: false
    })
    attachments?: string[];

    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'Additional metadata',
        example: { weather: 'sunny', temperature: '25°C' },
        required: false
    })
    metadata?: Record<string, any>;
}
