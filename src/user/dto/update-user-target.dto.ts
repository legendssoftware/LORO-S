import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsDate, IsEnum, IsNumber, IsOptional, IsString } from "class-validator";

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
    description: 'Current sales amount for the user (total of quotations + orders)',
    example: 45000,
    required: false
  })
  currentSalesAmount?: number;

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
    description: 'Current hours worked for the user',
    example: 120,
    required: false
  })
  currentHoursWorked?: number;

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
    description: 'Current number of new clients for the user',
    example: 3,
    required: false
  })
  currentNewClients?: number;

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
    description: 'Current number of new leads for the user',
    example: 15,
    required: false
  })
  currentNewLeads?: number;

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
    description: 'Current number of check-ins for the user',
    example: 10,
    required: false
  })
  currentCheckIns?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Target number of calls for the user',
    example: 50,
    required: false
  })
  targetCalls?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Current number of calls for the user',
    example: 35,
    required: false
  })
  currentCalls?: number;

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

  // Recurring Target Configuration
  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Enable automatic target recurrence',
    example: true,
    required: false,
    default: true
  })
  isRecurring?: boolean;

  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly'])
  @ApiProperty({
    description: 'Recurrence interval: daily, weekly, or monthly',
    enum: ['daily', 'weekly', 'monthly'],
    example: 'monthly',
    required: false,
    default: 'monthly'
  })
  recurringInterval?: 'daily' | 'weekly' | 'monthly';

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Carry forward unfulfilled targets to the next period',
    example: false,
    required: false,
    default: false
  })
  carryForwardUnfulfilled?: boolean;

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
    description: 'CGIC costs amount in ZAR (Compensation for Occupational Injuries and Diseases)',
    example: 1200,
    required: false
  })
  cgicCosts?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ApiProperty({
    description: 'Total monthly cost amount in ZAR',
    example: 41500,
    required: false
  })
  totalCost?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'ERP sales rep code (sales_code) for linking to ERP data',
    example: 'SAL001',
    required: false
  })
  erpSalesRepCode?: string;
} 