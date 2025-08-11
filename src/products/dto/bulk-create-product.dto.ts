import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateProductDto } from './create-product.dto';

export class BulkCreateProductDto {
    @IsArray()
    @ArrayMinSize(1, { message: 'At least one product is required' })
    @ArrayMaxSize(100, { message: 'Maximum 100 products can be created at once' })
    @ValidateNested({ each: true })
    @Type(() => CreateProductDto)
    @ApiProperty({
        description: 'Array of products to create',
        type: [CreateProductDto],
        minItems: 1,
        maxItems: 100,
        example: [
            {
                name: 'Product 1',
                description: 'Description for product 1',
                category: 'MEAT_POULTRY',
                price: 1200,
                barcode: '123456789',
                packageQuantity: 10,
                brand: 'Brand A',
                weight: 5,
                stockQuantity: 50,
                sku: 'SKU001',
                productReferenceCode: 'REF001'
            },
            {
                name: 'Product 2',
                description: 'Description for product 2',
                category: 'DAIRY',
                price: 800,
                barcode: '987654321',
                packageQuantity: 20,
                brand: 'Brand B',
                weight: 3,
                stockQuantity: 100,
                sku: 'SKU002',
                productReferenceCode: 'REF002'
            }
        ]
    })
    products: CreateProductDto[];

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Organization ID to associate with all products (optional)',
        example: 1,
        required: false
    })
    orgId?: number;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Branch ID to associate with all products (optional)',
        example: 1,
        required: false
    })
    branchId?: number;
}

export interface BulkProductResult {
    product: any | null;
    success: boolean;
    error?: string;
    index: number;
    sku?: string;
    name?: string;
}

export interface BulkCreateProductResponse {
    totalRequested: number;
    totalCreated: number;
    totalFailed: number;
    successRate: number;
    results: BulkProductResult[];
    message: string;
    errors?: string[];
    duration: number;
}
