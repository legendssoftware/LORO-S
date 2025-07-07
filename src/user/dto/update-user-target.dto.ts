import { ApiProperty } from "@nestjs/swagger";
import { IsDate, IsNumber, IsOptional, IsString } from "class-validator";

export class UpdateUserTargetDto {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target sales amount for the user (total of quotations + orders)',
    example: 50000,
    required: false
  })
  targetSalesAmount?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target quotations amount for the user (quotes made but not paid)',
    example: 30000,
    required: false
  })
  targetQuotationsAmount?: number;



  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Current quotations amount for the user (quotes made but not paid)',
    example: 18000,
    required: false
  })
  currentQuotationsAmount?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Current orders amount for the user (converted and paid)',
    example: 15000,
    required: false
  })
  currentOrdersAmount?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Currency for the target sales amount',
    example: 'USD',
    required: false
  })
  targetCurrency?: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target hours worked for the user',
    example: 160,
    required: false
  })
  targetHoursWorked?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target number of new clients for the user',
    example: 5,
    required: false
  })
  targetNewClients?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target number of new leads for the user',
    example: 20,
    required: false
  })
  targetNewLeads?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target number of check-ins for the user',
    example: 15,
    required: false
  })
  targetCheckIns?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target number of calls for the user',
    example: 50,
    required: false
  })
  targetCalls?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Target period (e.g., monthly, quarterly, annually)',
    example: 'monthly',
    required: false
  })
  targetPeriod?: string;

  @IsOptional()
  @IsDate()
  @ApiProperty({
    description: 'Start date of the target period',
    example: `${new Date('2023-01-01').toISOString()}`,
    required: false
  })
  periodStartDate?: Date;

  @IsOptional()
  @IsDate()
  @ApiProperty({
    description: 'End date of the target period',
    example: `${new Date('2023-12-31').toISOString()}`,
    required: false
  })
  periodEndDate?: Date;
} 