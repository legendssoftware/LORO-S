import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateCheckInDto } from './create.attendance.check.in.dto';
import { CreateCheckOutDto } from './create.attendance.check.out.dto';

export enum ConsolidateMode {
    IN = 'in',
    OUT = 'out'
}

export class ConsolidateAttendanceDto {
    @IsNotEmpty()
    @IsEnum(ConsolidateMode)
    @ApiProperty({
        enum: ConsolidateMode,
        description: 'Mode to determine whether to process check-ins or check-outs',
        example: ConsolidateMode.IN
    })
    mode: ConsolidateMode;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => Object)
    @ApiProperty({
        description: 'Array of attendance records to process. Structure depends on mode: use CreateCheckInDto format for "in" mode, CreateCheckOutDto format for "out" mode',
        type: 'array',
        items: {
            oneOf: [
                { $ref: '#/components/schemas/CreateCheckInDto' },
                { $ref: '#/components/schemas/CreateCheckOutDto' }
            ]
        },
        examples: {
            checkInRecords: {
                summary: 'Check-in records format',
                description: 'Format when mode is "in" - includes check-in time, location, and notes',
                value: [
                    {
                        checkIn: "2024-01-15T09:00:00Z",
                        checkInNotes: "Morning shift start",
                        checkInLatitude: -26.2041,
                        checkInLongitude: 28.0473,
                        owner: { uid: 123 },
                        branch: { uid: 1 }
                    },
                    {
                        checkIn: "2024-01-15T09:15:00Z",
                        checkInNotes: "Late arrival - traffic delay",
                        checkInLatitude: -26.2041,
                        checkInLongitude: 28.0473,
                        owner: { uid: 124 },
                        branch: { uid: 1 }
                    }
                ]
            },
            checkOutRecords: {
                summary: 'Check-out records format',
                description: 'Format when mode is "out" - includes check-out time and completion notes',
                value: [
                    {
                        checkOut: "2024-01-15T17:30:00Z",
                        checkOutNotes: "Regular shift completion",
                        checkOutLatitude: -26.2041,
                        checkOutLongitude: 28.0473,
                        owner: { uid: 123 }
                    },
                    {
                        checkOut: "2024-01-15T18:00:00Z",
                        checkOutNotes: "Overtime completion - project deadline",
                        checkOutLatitude: -26.2041,
                        checkOutLongitude: 28.0473,
                        owner: { uid: 124 }
                    }
                ]
            }
        }
    })
    records: (CreateCheckInDto | CreateCheckOutDto)[];

    @ApiProperty({
        description: 'Source system identifier for tracking external consolidations',
        example: 'ERP_SYSTEM_V1',
        required: false
    })
    sourceSystem?: string;

    @ApiProperty({
        description: 'Transaction ID for tracking the consolidation batch',
        example: 'TXN_20240115_001',
        required: false
    })
    transactionId?: string;
}
