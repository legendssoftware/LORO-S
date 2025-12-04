import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	IsString,
	IsOptional,
	IsEnum,
	IsDate,
	IsNotEmpty,
	IsNumber,
	IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PayslipStatus {
	GENERATED = 'GENERATED',
	SENT = 'SENT',
	VIEWED = 'VIEWED',
}

export class CreatePayslipDto {
	@ApiProperty({
		description: 'User reference for whom the payslip is created',
		example: { uid: 1 },
		required: true,
	})
	@IsObject()
	@IsNotEmpty()
	user: { uid: number };

	@ApiProperty({
		description: 'Pay period (e.g., "2024-01" or "January 2024")',
		example: '2024-01',
		required: true,
	})
	@IsString()
	@IsNotEmpty()
	period: string;

	@ApiProperty({
		description: 'Date when the payslip was issued',
		example: '2024-01-31T00:00:00Z',
		required: true,
	})
	@Type(() => Date)
	@IsDate()
	@IsNotEmpty()
	issueDate: Date;

	@ApiPropertyOptional({
		description: 'Payslip number or reference',
		example: 'PS-2024-001',
	})
	@IsString()
	@IsOptional()
	payslipNumber?: string;

	@ApiPropertyOptional({
		description: 'Net pay amount after deductions',
		example: 25000.00,
	})
	@IsNumber()
	@IsOptional()
	netPay?: number;

	@ApiPropertyOptional({
		description: 'Gross pay amount before deductions',
		example: 30000.00,
	})
	@IsNumber()
	@IsOptional()
	grossPay?: number;

	@ApiPropertyOptional({
		description: 'Direct URL to the payslip document',
		example: 'https://storage.example.com/payslips/12345.pdf',
	})
	@IsString()
	@IsOptional()
	documentUrl?: string;

	@ApiPropertyOptional({
		description: 'Reference to document in docs table',
		example: 123,
	})
	@IsNumber()
	@IsOptional()
	documentRef?: number;

	@ApiPropertyOptional({
		description: 'Status of the payslip',
		enum: PayslipStatus,
		example: PayslipStatus.GENERATED,
		default: PayslipStatus.GENERATED,
	})
	@IsEnum(PayslipStatus)
	@IsOptional()
	status?: PayslipStatus;
}
