import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize, IsNumber, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateProductDto } from './update-product.dto';

export class BulkUpdateProductItem {
    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({
        description: 'Product reference ID to update',
        example: 123
    })
    ref: number;

    @ValidateNested()
    @Type(() => UpdateProductDto)
    @ApiProperty({
        description: 'Product data to update',
        type: UpdateProductDto
    })
    data: UpdateProductDto;
}

export class BulkUpdateProductDto {
    @IsArray()
    @ArrayMinSize(1, { message: 'At least one product update is required' })
    @ArrayMaxSize(100, { message: 'Maximum 100 products can be updated at once' })
    @ValidateNested({ each: true })
    @Type(() => BulkUpdateProductItem)
    @ApiProperty({
        description: 'Array of product updates',
        type: [BulkUpdateProductItem],
        minItems: 1,
        maxItems: 100,
        example: [
            {
                ref: 123,
                data: {
                    name: 'Updated Product 1',
                    price: 1500,
                    stockQuantity: 75
                }
            },
            {
                ref: 124,
                data: {
                    name: 'Updated Product 2',
                    price: 900,
                    stockQuantity: 120
                }
            }
        ]
    })
    updates: BulkUpdateProductItem[];
}

export interface BulkUpdateProductResult {
    ref: number;
    success: boolean;
    error?: string;
    index: number;
    name?: string;
    updatedFields?: string[];
}

export interface BulkUpdateProductResponse {
    totalRequested: number;
    totalUpdated: number;
    totalFailed: number;
    successRate: number;
    results: BulkUpdateProductResult[];
    message: string;
    errors?: string[];
    duration: number;
}
