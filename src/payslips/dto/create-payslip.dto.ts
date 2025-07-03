import { IsOptional, IsString, IsNotEmpty, IsNumber, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetPayslipsDto {
    @ApiProperty({ 
        description: 'Limit number of payslips to return', 
        required: false,
        example: 10
    })
    @IsOptional()
    @IsNumber()
    limit?: number;

    @ApiProperty({ 
        description: 'Skip number of payslips for pagination', 
        required: false,
        example: 0
    })
    @IsOptional()
    @IsNumber()
    offset?: number;
}

export class FetchPayslipDto {
    @ApiProperty({ 
        description: 'File name or reference in Google Cloud Storage', 
        example: 'payslip-january-2024.pdf'
    })
    @IsNotEmpty()
    @IsString()
    fileName: string;

    @ApiProperty({ 
        description: 'User ID or owner reference for the payslip', 
        example: 123
    })
    @IsNotEmpty()
    userId: number;

    @ApiProperty({ 
        description: 'Optional title for the payslip document', 
        required: false,
        example: 'January 2024 Payslip'
    })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ 
        description: 'Optional description for the payslip document', 
        required: false,
        example: 'Monthly payslip for January 2024'
    })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ 
        description: 'Optional file size if known (bytes)', 
        required: false,
        example: 256789
    })
    @IsOptional()
    @IsNumber()
    fileSize?: number;

    @ApiProperty({ 
        description: 'Optional MIME type if known', 
        required: false,
        example: 'application/pdf'
    })
    @IsOptional()
    @IsString()
    mimeType?: string;

    @ApiProperty({ 
        description: 'Optional public URL if file is in external bucket', 
        required: false,
        example: 'https://external-bucket.com/payslips/file.pdf'
    })
    @IsOptional()
    @IsUrl()
    externalUrl?: string;

    @ApiProperty({ 
        description: 'Optional bucket name if file is in different bucket', 
        required: false,
        example: 'external-payslips-bucket'
    })
    @IsOptional()
    @IsString()
    bucketName?: string;
}

export class HrPayslipUploadDto {
    @ApiProperty({ 
        description: 'HR system ID of the HR user processing the payslip', 
        example: 12345
    })
    @IsNotEmpty()
    @IsNumber()
    hrID: number;

    @ApiProperty({ 
        description: 'Employee ID (user uid) who owns the payslip', 
        example: 123
    })
    @IsNotEmpty()
    @IsNumber()
    employeeID: number;

    @ApiProperty({ 
        description: 'File reference/path in Google Cloud Storage', 
        example: 'payslips/2024/01/employee-123-january-2024.pdf'
    })
    @IsNotEmpty()
    @IsString()
    fileReference: string;

    @ApiProperty({ 
        description: 'Optional title for the payslip', 
        required: false,
        example: 'January 2024 Payslip'
    })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ 
        description: 'Optional description for the payslip', 
        required: false,
        example: 'Monthly payslip for January 2024'
    })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ 
        description: 'Optional period covered by the payslip', 
        required: false,
        example: '2024-01'
    })
    @IsOptional()
    @IsString()
    payPeriod?: string;

    @ApiProperty({ 
        description: 'Optional bucket name if file is in different bucket', 
        required: false,
        example: 'hr-payslips-bucket'
    })
    @IsOptional()
    @IsString()
    bucketName?: string;
}
