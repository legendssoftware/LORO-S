import { Controller, Get, Post, Body, Query, Param, UseGuards, Req, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { PayslipsService } from './payslips.service';
import { GetPayslipsDto, FetchPayslipDto, HrPayslipUploadDto } from './dto/create-payslip.dto';

@ApiTags('Payslips')
@ApiBearerAuth()
@UseGuards(AuthGuard, RoleGuard)
@Controller('payslips')
export class PayslipsController {
  constructor(private readonly payslipsService: PayslipsService) {}

  @Get()
  @ApiOperation({ 
    summary: 'Get user payslips',
    description: 'Retrieve all payslips for the authenticated user with optional date filtering'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'List of user payslips',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          uid: { type: 'number', example: 1 },
          title: { type: 'string', example: 'Payslip - January 2024' },
          description: { type: 'string', example: 'Monthly payslip for January 2024' },
          url: { type: 'string', example: 'https://storage.example.com/payslips/payslip-jan-2024.pdf' },
          fileSize: { type: 'number', example: 256789 },
          mimeType: { type: 'string', example: 'application/pdf' },
          extension: { type: 'string', example: 'pdf' },
          createdAt: { type: 'string', format: 'date-time' },
          metadata: { type: 'object', nullable: true }
        }
      }
    }
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Limit number of payslips to return' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Skip number of payslips for pagination' })
  async getUserPayslips(@Req() req: any, @Query() filters: GetPayslipsDto) {
    const userId = req.user.uid;
    return this.payslipsService.getUserPayslips(userId, filters);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get payslip by ID',
    description: 'Retrieve a specific payslip by ID for the authenticated user'
  })
  @ApiParam({ name: 'id', type: 'number', description: 'Payslip ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Payslip details',
    schema: {
      type: 'object',
      properties: {
        uid: { type: 'number', example: 1 },
        title: { type: 'string', example: 'Payslip - January 2024' },
        description: { type: 'string', example: 'Monthly payslip for January 2024' },
        url: { type: 'string', example: 'https://storage.example.com/payslips/payslip-jan-2024.pdf' },
        fileSize: { type: 'number', example: 256789 },
        mimeType: { type: 'string', example: 'application/pdf' },
        extension: { type: 'string', example: 'pdf' },
        createdAt: { type: 'string', format: 'date-time' },
        metadata: { type: 'object', nullable: true }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Payslip not found' })
  async getPayslipById(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.uid;
    const payslip = await this.payslipsService.getPayslipById(userId, +id);
    
    if (!payslip) {
      throw new NotFoundException('Payslip not found');
    }
    
    return payslip;
  }

  @Post('fetch-from-gcs')
  @ApiOperation({ 
    summary: 'Fetch payslip from Google Cloud Storage or external bucket',
    description: 'Fetch a payslip file from GCS using fileName and userId. If file is in an inaccessible bucket, creates record with provided sample data while maintaining consistent creator links'
  })
  @ApiBody({ type: FetchPayslipDto })
  @ApiResponse({ 
    status: 201, 
    description: 'Payslip fetched and populated successfully',
    schema: {
      type: 'object',
      properties: {
        uid: { type: 'number', example: 1 },
        title: { type: 'string', example: 'Payslip - January 2024' },
        description: { type: 'string', example: 'Monthly payslip for January 2024' },
        url: { type: 'string', example: 'https://storage.example.com/payslips/payslip-jan-2024.pdf' },
        fileSize: { type: 'number', example: 256789 },
        mimeType: { type: 'string', example: 'application/pdf' },
        extension: { type: 'string', example: 'pdf' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        metadata: { 
          type: 'object', 
          nullable: true,
          description: 'File metadata from GCS or sample data with user context'
        },
        isAccessible: { 
          type: 'boolean', 
          example: true,
          description: 'Whether the file was accessible in our GCS bucket'
        },
        source: { 
          type: 'string', 
          example: 'gcs_fetch',
          enum: ['gcs_fetch', 'external_bucket'],
          description: 'Source of the file data - direct GCS fetch or external/sample data'
        },
        message: { 
          type: 'string', 
          example: 'Payslip created successfully',
          description: 'Success message indicating creation/update and data source'
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid input or file fetch failed' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async fetchPayslipFromGcs(@Body() fetchPayslipDto: FetchPayslipDto) {
    return this.payslipsService.fetchAndPopulatePayslip(fetchPayslipDto);
  }

  @Post('hr-upload')
  @ApiOperation({ 
    summary: 'HR payslip upload and notification',
    description: 'Process a payslip file from GCS, save it to doc entity, and notify the employee via email about payslip availability'
  })
  @ApiBody({ type: HrPayslipUploadDto })
  @ApiResponse({ 
    status: 201, 
    description: 'Payslip processed and employee notified successfully',
    schema: {
      type: 'object',
      properties: {
        uid: { type: 'number', example: 1 },
        title: { type: 'string', example: 'Payslip - January 2024' },
        description: { type: 'string', example: 'Monthly payslip for January 2024' },
        url: { type: 'string', example: 'https://storage.example.com/payslips/payslip-jan-2024.pdf' },
        fileSize: { type: 'number', example: 256789 },
        mimeType: { type: 'string', example: 'application/pdf' },
        extension: { type: 'string', example: 'pdf' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        message: { 
          type: 'string', 
          example: 'Payslip uploaded successfully and employee notified',
          description: 'Success message indicating upload and notification status'
        },
        emailSent: { 
          type: 'boolean', 
          example: true,
          description: 'Whether email notification was sent to employee'
        },
        employeeEmail: { 
          type: 'string', 
          example: 'employee@company.com',
          description: 'Email address where notification was sent'
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid input, file not found, or processing failed' })
  @ApiResponse({ status: 404, description: 'Employee not found or HR user not found' })
  async uploadPayslipFromHr(@Body() hrPayslipUploadDto: HrPayslipUploadDto) {
    return this.payslipsService.processHrPayslipUpload(hrPayslipUploadDto);
  }
}
