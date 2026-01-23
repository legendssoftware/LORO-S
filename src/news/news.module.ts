import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { NewsService } from './news.service';
import { NewsController } from './news.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { News } from './entities/news.entity';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
  imports: [
		ClerkModule,
    LicensingModule,
    TypeOrmModule.forFeature([News])
  ],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule { }
