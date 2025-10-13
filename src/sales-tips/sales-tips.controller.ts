import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SalesTipsService } from './sales-tips.service';
import { CreateSalesTipDto } from './dto/create-sales-tip.dto';
import { UpdateSalesTipDto } from './dto/update-sales-tip.dto';

@Controller('sales-tips')
export class SalesTipsController {
  constructor(private readonly salesTipsService: SalesTipsService) {}

  @Get('tip-of-the-day')
  getTipOfTheDay() {
    return this.salesTipsService.getTipByDate();
  }

  @Post('trigger-broadcast')
  async triggerSalesTipBroadcast() {
    return this.salesTipsService.triggerManualSalesTip();
  }

  @Post()
  create(@Body() createSalesTipDto: CreateSalesTipDto) {
    return this.salesTipsService.create(createSalesTipDto);
  }

  @Get()
  findAll() {
    return this.salesTipsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesTipsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSalesTipDto: UpdateSalesTipDto) {
    return this.salesTipsService.update(+id, updateSalesTipDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.salesTipsService.remove(+id);
  }
}
