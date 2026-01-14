import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Banners } from './entities/banners.entity';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService {
    private readonly logger = new Logger(BannersService.name);

    constructor(
        @InjectRepository(Banners)
        private bannersRepository: Repository<Banners>
    ) {}

    async create(createBannerDto: CreateBannerDto) {
        const operationId = `create_banner_${Date.now()}`;
        this.logger.log(`[${operationId}] Creating banner`);
        
        try {
            const banner = await this.bannersRepository.save(createBannerDto);
            this.logger.log(`[${operationId}] ✅ FINAL CREATE BANNER RESPONSE:`, {
                response: banner,
                bannerId: banner.uid,
                title: banner.title,
            });
            return banner;
        } catch (error) {
            this.logger.error(`[${operationId}] Error creating banner: ${error.message}`, error.stack);
            throw error;
        }
    }

    async findAll() {
        const operationId = `find_all_banners_${Date.now()}`;
        this.logger.log(`[${operationId}] Fetching all banners`);
        
        try {
            const banners = await this.bannersRepository.find();
            this.logger.log(`[${operationId}] ✅ FINAL FIND ALL BANNERS RESPONSE:`, {
                response: banners,
                bannersCount: banners.length,
                banners: banners.map(b => ({
                    uid: b.uid,
                    title: b.title,
                    subtitle: b.subtitle,
                    image: b.image,
                    category: b.category,
                })),
            });
            return banners;
        } catch (error) {
            this.logger.error(`[${operationId}] Error fetching all banners: ${error.message}`, error.stack);
            throw error;
        }
    }

    async findOne(id: number) {
        const operationId = `find_one_banner_${id}_${Date.now()}`;
        this.logger.log(`[${operationId}] Fetching banner with ID: ${id}`);
        
        try {
            const banner = await this.bannersRepository.findOne({ where: { uid: id } });
            this.logger.log(`[${operationId}] ✅ FINAL FIND ONE BANNER RESPONSE:`, {
                response: banner,
                bannerId: id,
                found: !!banner,
                banner: banner ? {
                    uid: banner.uid,
                    title: banner.title,
                    subtitle: banner.subtitle,
                    image: banner.image,
                    category: banner.category,
                } : null,
            });
            return banner;
        } catch (error) {
            this.logger.error(`[${operationId}] Error fetching banner: ${error.message}`, error.stack);
            throw error;
        }
    }

    async update(id: number, updateBannerDto: UpdateBannerDto) {
        const operationId = `update_banner_${id}_${Date.now()}`;
        this.logger.log(`[${operationId}] Updating banner with ID: ${id}`);
        
        try {
            const result = await this.bannersRepository.update(id, updateBannerDto);
            this.logger.log(`[${operationId}] ✅ FINAL UPDATE BANNER RESPONSE:`, {
                response: result,
                bannerId: id,
                affected: result.affected,
                updateData: updateBannerDto,
            });
            return result;
        } catch (error) {
            this.logger.error(`[${operationId}] Error updating banner: ${error.message}`, error.stack);
            throw error;
        }
    }

    async remove(id: number) {
        const operationId = `remove_banner_${id}_${Date.now()}`;
        this.logger.log(`[${operationId}] Removing banner with ID: ${id}`);
        
        try {
            const result = await this.bannersRepository.delete(id);
            this.logger.log(`[${operationId}] ✅ FINAL REMOVE BANNER RESPONSE:`, {
                response: result,
                bannerId: id,
                affected: result.affected,
            });
            return result;
        } catch (error) {
            this.logger.error(`[${operationId}] Error removing banner: ${error.message}`, error.stack);
            throw error;
        }
    }
} 