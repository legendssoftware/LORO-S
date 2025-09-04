import { PartialType } from '@nestjs/swagger';
import { CreateIotDto } from './create-iot.dto';

export class UpdateIotDto extends PartialType(CreateIotDto) {}
