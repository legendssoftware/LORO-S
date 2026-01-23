import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { PdfGenerationService } from './pdf-generation.service';
import { PdfGenerationController } from './pdf-generation.controller';
import { StorageService } from '../lib/services/storage.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Doc } from '../docs/entities/doc.entity';
import { JwtModule } from '@nestjs/jwt';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
	imports: [
		ClerkModule,
		TypeOrmModule.forFeature([Doc]),
		JwtModule.register({
			secret: process.env.JWT_SECRET || 'K9HXmP$2vL5nR8qY3wZ7jB4cF6hN9kM@pT2xS5vA8dG4jE7mQ9nU',
			signOptions: { expiresIn: '1h' },
		}),
		LicensingModule,
	],
	controllers: [PdfGenerationController],
	providers: [PdfGenerationService, StorageService],
	exports: [PdfGenerationService],
})
export class PdfGenerationModule {}
