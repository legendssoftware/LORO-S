import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { LicensingModule } from '../licensing/licensing.module';

import { IotService } from './iot.service';
import { IotController } from './iot.controller';
import { Device, DeviceRecords } from './entities/iot.entity';
import { IoTReportingService } from './services/iot-reporting.service';

/**
 * IoT Module
 * 
 * Provides comprehensive IoT device management and time tracking capabilities.
 * Includes device registration, time event recording, analytics, and reporting.
 */
@Module({
  imports: [
    // TypeORM for entity management
    TypeOrmModule.forFeature([Device, DeviceRecords]),
    
    // Cache module for performance optimization
    CacheModule.register({
      ttl: 300, // 5 minutes default TTL
      max: 1000, // Maximum number of items in cache
    }),
    
    // Event emitter for real-time notifications
    EventEmitterModule.forRoot(),
    
    // Config module for environment variables
    ConfigModule,
    
    // Auth module for JWT service (required by AuthGuard)
    AuthModule,
    
    // Licensing module for LicensingService (required by AuthGuard)
    LicensingModule,
  ],
  controllers: [IotController],
  providers: [
    IotService,
    IoTReportingService,
  ],
  exports: [
    IotService,
    IoTReportingService,
    TypeOrmModule, // Export for other modules that might need IoT entities
  ],
})
export class IotModule {}
