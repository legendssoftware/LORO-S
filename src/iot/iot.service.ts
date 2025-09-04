import { Injectable } from '@nestjs/common';
import { CreateIotDto } from './dto/create-iot.dto';
import { UpdateIotDto } from './dto/update-iot.dto';

@Injectable()
export class IotService {
  create(createIotDto: CreateIotDto) {
    return 'This action adds a new iot';
  }

  findAll() {
    return `This action returns all iot`;
  }

  findOne(id: number) {
    return `This action returns a #${id} iot`;
  }

  update(id: number, updateIotDto: UpdateIotDto) {
    return `This action updates a #${id} iot`;
  }

  remove(id: number) {
    return `This action removes a #${id} iot`;
  }
}
