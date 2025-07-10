import { ApiProperty } from '@nestjs/swagger';

export class CreatePdfGenerationDto {
  @ApiProperty({
    description: 'The name of the template to use for PDF generation',
    example: 'quotation',
    enum: ['quotation']
  })
  template: string;

  @ApiProperty({
    description: 'The data to populate the template with. Structure varies by template type.',
    example: {
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
  })
  data: Record<string, any>;
}
