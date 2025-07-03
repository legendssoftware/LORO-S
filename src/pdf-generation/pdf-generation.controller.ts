import { Controller, Post, Body, Get, Param, Delete, HttpStatus, HttpCode } from '@nestjs/common';
import { PdfGenerationService } from './pdf-generation.service';
import { CreatePdfGenerationDto } from './dto/create-pdf-generation.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('⚙️ PDF Generation')
@Controller('pdf-generation')
export class PdfGenerationController {
  constructor(private readonly pdfGenerationService: PdfGenerationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a PDF from a template and data' })
  @ApiBody({ type: CreatePdfGenerationDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'The PDF has been successfully generated and uploaded' 
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid template or data format'
  })
  create(@Body() createPdfGenerationDto: CreatePdfGenerationDto) {
    return this.pdfGenerationService.create(createPdfGenerationDto);
  }

  @Get()
  @ApiOperation({ summary: 'List available PDF templates' })
  findAll() {
    return this.pdfGenerationService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get information about a generated PDF by ID' })
  findOne(@Param('id') id: string) {
    return this.pdfGenerationService.findOne(+id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a generated PDF by ID' })
  remove(@Param('id') id: string) {
    return this.pdfGenerationService.remove(+id);
  }
}
