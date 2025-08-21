import { Module } from '@nestjs/common';
import { MapService } from './map.service';
import { MapController } from './map.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from '../attendance/entities/attendance.entity';
import { Client } from '../clients/entities/client.entity';
import { Competitor } from '../competitors/entities/competitor.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Organisation } from '../organisation/entities/organisation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Attendance, Client, Competitor, Quotation, Branch, Organisation])],
  controllers: [MapController],
  providers: [MapService],
})
export class MapModule {}
