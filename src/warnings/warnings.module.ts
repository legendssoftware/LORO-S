import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { WarningsService } from './warnings.service';
import { WarningsController } from './warnings.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warning } from './entities/warning.entity';
import { User } from '../user/entities/user.entity';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CommunicationModule } from '../communication/communication.module';
import { JwtModule } from '@nestjs/jwt';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
	imports: [
		ClerkModule,
		TypeOrmModule.forFeature([Warning, User]),
		CacheModule.registerAsync({
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => {
				const ttl = configService.get<number>('CACHE_EXPIRATION_TIME', 30) * 1000;
				const maxItems = parseInt(configService.get('CACHE_MAX_ITEMS', '100'), 10);
				return {
					ttl,
					max: isNaN(maxItems) || maxItems <= 0 ? 100 : maxItems, // Ensure valid positive integer
				};
			},
			inject: [ConfigService],
		}),
		CommunicationModule,
		LicensingModule,
		JwtModule.register({
			secret: process.env.JWT_SECRET,
			signOptions: { expiresIn: '1d' },
		}),
	],
	controllers: [WarningsController],
	providers: [WarningsService],
	exports: [WarningsService],
})
export class WarningsModule {}
