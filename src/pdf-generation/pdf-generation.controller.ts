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
  @ApiOperation({ 
    summary: 'Generate a PDF from a template and data',
    description: 'Generates a PDF document from the specified template and data, uploads it to cloud storage, and returns the public URL. Supports comprehensive validation and fallback handling for robust PDF generation.'
  })
  @ApiBody({ 
    type: CreatePdfGenerationDto,
    description: 'PDF generation request with template name and data',
    examples: {
      quotation: {
        summary: 'Quotation PDF Example',
        value: {
          template: 'quotation',
          data: {
            quotationId: 'QUO-1704067200000',
            companyDetails: {
              name: 'Loro',
              addressLines: ['123 Business St', 'Cape Town, 8001'],
              phone: '+27 21 123 4567',
              email: 'info@loro.co.za'
            },
            client: {
              name: 'Acme Corp',
              email: 'contact@acme.com',
              address: '456 Client Ave, Cape Town'
            },
            items: [
              {
                itemCode: 'PROD-001',
                description: 'Sample Product',
                quantity: 2,
                unitPrice: 100
              }
            ],
            total: 200,
            currency: 'ZAR'
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'The PDF has been successfully generated and uploaded',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'PDF generated and uploaded successfully' },
        url: { type: 'string', example: 'https://storage.googleapis.com/bucket/quotation_1704067200000_abc123.pdf' },
        fileName: { type: 'string', example: 'quotation_1704067200000_abc123.pdf' },
        size: { type: 'number', example: 45678, description: 'PDF file size in bytes' },
        generationTime: { type: 'number', example: 1250, description: 'Generation time in milliseconds' }
      }
    }
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid template, data format, or validation errors',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          examples: [
            'Valid template name is required',
            'Valid data object is required for PDF generation',
            'Quotation must have at least one item',
            'PDF template generation failed: Template processing error'
          ]
        },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
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
