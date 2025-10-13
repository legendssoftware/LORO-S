import { PartialType } from '@nestjs/swagger';
import { CreateSalesTipDto } from './create-sales-tip.dto';

export class UpdateSalesTipDto extends PartialType(CreateSalesTipDto) {}
