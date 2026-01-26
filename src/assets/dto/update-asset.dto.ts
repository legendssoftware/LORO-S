import { IsBoolean, IsDate, IsObject, IsOptional, IsString } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateAssetDto } from './create-asset.dto';
import { OwnerUidDto } from '../../lib/dto/owner-uid.dto';
import { Type } from 'class-transformer';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
    @IsOptional()
    @IsString()
    brand?: string;

    @IsOptional()
    @IsString()
    serialNumber?: string;

    @IsOptional()
    @IsString()
    modelNumber?: string;

    @IsOptional()
    @IsDate()
    purchaseDate?: Date;

    @IsOptional()
    @IsBoolean()
    hasInsurance?: boolean;

    @IsOptional()
    @IsString()
    insuranceProvider?: string;

    @IsOptional()
    @IsDate()
    insuranceExpiryDate?: Date;

    @IsOptional()
    @IsObject()
    @Type(() => OwnerUidDto)
    owner?: OwnerUidDto;

    @IsOptional()
    @IsObject()
    branch?: { uid: number };
}
