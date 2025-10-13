import { Module } from '@nestjs/common';
import { SalesTipsService } from './sales-tips.service';
import { SalesTipsController } from './sales-tips.controller';

@Module({
  controllers: [SalesTipsController],
  providers: [SalesTipsService],
  exports: [SalesTipsService],
})
export class SalesTipsModule {}
