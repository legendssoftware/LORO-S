import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsDate, IsEnum } from 'class-validator';
import { ProductStatus } from '../../lib/enums/product.enums';

export class CreateProductDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The name of the product',
        example: 'Product Name'
    })
    name: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'The description of the product',
        example: 'Product Description'
    })
    description?: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The category of the product',
        example: 'MEAT_POULTRY'
    })
    category: string;

    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The price of the product',
        example: 1230
    })
    price: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'The sale price of the product',
        example: 110
    })
    salePrice?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'The discount percentage',
        example: 10
    })
    discount?: number;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The barcode of the product',
        example: '123213213'
    })
    barcode: string;

    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The package quantity',
        example: 20
    })
    packageQuantity: number;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The brand of the product',
        example: 'Brand Name'
    })
    brand: string;

    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The weight of the product',
        example: 10
    })
    weight: number;

    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The stock quantity',
        example: 110
    })
    stockQuantity: number;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The SKU of the product',
        example: '09BCL44P09011'
    })
    sku: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'The URL of the product image',
        example: 'https://example.com/image.jpg'
    })
    imageUrl?: string;

    @IsEnum(ProductStatus)
    @IsOptional()
    @ApiProperty({
        description: 'Product status (e.g. new, special, bestseller, hotdeals, active, outofstock)',
        enum: ProductStatus,
        example: ProductStatus.NEW,
        required: false
    })
    status?: ProductStatus;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'The warehouse location of the product',
        example: '123123'
    })
    warehouseLocation?: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: 'The product reference code',
        example: 'redfe332'
    })
    productReferenceCode: string;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'The reorder point for stock management',
        example: 10
    })
    reorderPoint?: number;

    @IsBoolean()
    @IsOptional()
    @ApiProperty({
        description: 'Whether the product is on promotion',
        example: false
    })
    isOnPromotion?: boolean;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Additional package details',
        example: 'extra'
    })
    packageDetails?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'The product reference',
        example: 'redfe332'
    })
    productRef?: string;

    @IsBoolean()
    @IsOptional()
    @ApiProperty({
        description: 'Whether the product is deleted',
        example: false
    })
    isDeleted?: boolean;

    @IsDate()
    @IsOptional()
    @ApiProperty({
        description: 'The promotion start date',
        example: null
    })
    promotionStartDate?: Date;

    @IsDate()
    @IsOptional()
    @ApiProperty({
        description: 'The promotion end date',
        example: null
    })
    promotionEndDate?: Date;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'The package unit',
        example: 'unit'
    })
    packageUnit?: string;

    // Enhanced product fields for detailed product information
    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Number of items per pack',
        example: 12,
        required: false
    })
    itemsPerPack?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Number of packs per pallet',
        example: 20,
        required: false
    })
    packsPerPallet?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Price per pack',
        example: 120.50,
        required: false
    })
    packPrice?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Price per pallet',
        example: 2400.00,
        required: false
    })
    palletPrice?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Weight of a pack in kg',
        example: 5.2,
        required: false
    })
    packWeight?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Weight of a pallet in kg',
        example: 104.0,
        required: false
    })
    palletWeight?: number;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Product dimensions (L x W x H)',
        example: '20cm x 15cm x 10cm',
        required: false
    })
    dimensions?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Pack dimensions (L x W x H)',
        example: '25cm x 20cm x 15cm',
        required: false
    })
    packDimensions?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Pallet dimensions (L x W x H)',
        example: '120cm x 80cm x 150cm',
        required: false
    })
    palletDimensions?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Product manufacturer',
        example: 'Acme Corp',
        required: false
    })
    manufacturer?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Product model number',
        example: 'AC-2024-PRO',
        required: false
    })
    model?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Product color',
        example: 'Blue',
        required: false
    })
    color?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Product material',
        example: 'Stainless Steel',
        required: false
    })
    material?: string;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Warranty period duration',
        example: 24,
        required: false
    })
    warrantyPeriod?: number;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Warranty period unit',
        example: 'months',
        default: 'months',
        required: false
    })
    warrantyUnit?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Detailed product specifications',
        example: 'Power: 500W, Voltage: 220V, Frequency: 50Hz',
        required: false
    })
    specifications?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Product features list',
        example: 'Waterproof, Energy efficient, LED display',
        required: false
    })
    features?: string;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Product rating (1-5 stars)',
        example: 4.5,
        minimum: 0,
        maximum: 5,
        required: false
    })
    rating?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Number of customer reviews',
        example: 1250,
        required: false
    })
    reviewCount?: number;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Country or region of origin',
        example: 'Germany',
        required: false
    })
    origin?: string;

    @IsBoolean()
    @IsOptional()
    @ApiProperty({
        description: 'Whether the product is fragile and requires careful handling',
        example: false,
        default: false,
        required: false
    })
    isFragile?: boolean;

    @IsBoolean()
    @IsOptional()
    @ApiProperty({
        description: 'Whether the product requires special handling during shipping',
        example: false,
        default: false,
        required: false
    })
    requiresSpecialHandling?: boolean;

    @IsString()
    @IsOptional()
    @ApiProperty({
        description: 'Storage conditions requirements',
        example: 'Store in cool, dry place. Temperature: 15-25°C',
        required: false
    })
    storageConditions?: string;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Minimum order quantity required',
        example: 10,
        required: false
    })
    minimumOrderQuantity?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Bulk discount percentage for large orders',
        example: 15.5,
        required: false
    })
    bulkDiscountPercentage?: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({
        description: 'Minimum quantity to qualify for bulk discount',
        example: 100,
        required: false
    })
    bulkDiscountMinQty?: number;
}