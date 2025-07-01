import { PartialType } from '@nestjs/swagger';
import { CreatePayslipDto } from './create-payslip.dto';

export class UpdatePayslipDto extends PartialType(CreatePayslipDto) {}
