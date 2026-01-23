import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiUnauthorizedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SalesTipsService } from './sales-tips.service';
import { CreateSalesTipDto } from './dto/create-sales-tip.dto';
import { UpdateSalesTipDto } from './dto/update-sales-tip.dto';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { SalesTip } from './entities/sales-tip.entity';

@ApiTags('💡 Sales Tips')
@Controller('sales-tips')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class SalesTipsController {
  constructor(private readonly salesTipsService: SalesTipsService) {}

  @Get('tip-of-the-day')
  @ApiOperation({ 
    summary: 'Get tip of the day',
    description: 'Returns a randomized sales tip for today based on the current date'
  })
  @ApiOkResponse({ 
    description: 'Successfully retrieved tip of the day',
    type: SalesTip
  })
  getTipOfTheDay() {
    return this.salesTipsService.getTipByDate();
  }

  @Post('trigger-broadcast')
  @ApiOperation({ 
    summary: 'Trigger manual sales tip broadcast',
    description: 'Manually triggers sending sales tips to all active users'
  })
  async triggerSalesTipBroadcast() {
    return this.salesTipsService.triggerManualSalesTip();
  }

  @Post()
  create(@Body() createSalesTipDto: CreateSalesTipDto) {
    return this.salesTipsService.create(createSalesTipDto);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all sales tips',
    description: 'Returns all available sales tips from the collection. Used for displaying tips in the mobile app carousel.'
  })
  @ApiOkResponse({ 
    description: 'Successfully retrieved all sales tips',
    type: [SalesTip]
  })
  findAll(): SalesTip[] {
    return this.salesTipsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get a specific sales tip by ID',
    description: 'Returns a single sales tip by its ID'
  })
  @ApiOkResponse({ 
    description: 'Successfully retrieved sales tip',
    type: SalesTip
  })
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
