import { ApiProperty } from "@nestjs/swagger";
import { IsDate, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateUserTargetDto {
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

  // Cost Breakdown Fields (Monthly) - All in ZAR
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Base salary amount in ZAR',
    example: 25000,
    required: false
  })
  baseSalary?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Car instalment amount in ZAR',
    example: 8000,
    required: false
  })
  carInstalment?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Car insurance amount in ZAR',
    example: 1500,
    required: false
  })
  carInsurance?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Fuel allowance amount in ZAR',
    example: 3000,
    required: false
  })
  fuel?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Cell phone allowance amount in ZAR',
    example: 800,
    required: false
  })
  cellPhoneAllowance?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Car maintenance amount in ZAR',
    example: 2000,
    required: false
  })
  carMaintenance?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'COIC costs amount in ZAR',
    example: 1200,
    required: false
  })
  coicCosts?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Total monthly cost amount in ZAR',
    example: 41500,
    required: false
  })
  totalCost?: number;
} 