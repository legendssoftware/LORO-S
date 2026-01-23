import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@nestjs/config';
import { ClerkModule } from '../clerk/clerk.module';
import { LicensingModule } from '../licensing/licensing.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ErpModule } from '../erp/erp.module';

import { IotService } from './iot.service';
import { IotController } from './iot.controller';
import { Device, DeviceRecords, DeviceLogs } from './entities/iot.entity';
import { User } from '../user/entities/user.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Attendance } from '../attendance/entities/attendance.entity';
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
    TypeOrmModule.forFeature([Device, DeviceRecords, DeviceLogs, User, Branch, Attendance]),
    
    // Cache module for performance optimization
    CacheModule.register({
      ttl: 300, // 5 minutes default TTL
      max: 1000, // Maximum number of items in cache
    }),
    
    // Event emitter for real-time notifications
    EventEmitterModule.forRoot(),
    
    // Config module for environment variables
    ConfigModule,
    
    // Clerk module for authentication (replaces AuthModule)
    ClerkModule,
    
    // Licensing module for LicensingService
    LicensingModule,
    
    // Organisation module for business hours validation
    OrganisationModule,
    
    // Notifications module for push notifications to admin users
    NotificationsModule,
    
    // ERP module for branch name normalization
    ErpModule,
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
