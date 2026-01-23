import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LicensingService } from './licensing.service';
import { LicensingController } from './licensing.controller';
import { LicensingNotificationsService } from './licensing-notifications.service';
import { LicenseUsageService } from './license-usage.service';
import { License } from './entities/license.entity';
import { LicenseUsage } from './entities/license-usage.entity';
import { LicenseEvent } from './entities/license-event.entity';
import { LicenseAudit } from './entities/license-audit.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { LicenseRateLimitGuard } from './lib/guards/license-rate-limit.guard';
import { LicenseExceptionFilter } from './lib/filters/license-exception.filter';
import { LicenseAuditService } from './lib/audit.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([License, LicenseUsage, LicenseEvent, LicenseAudit, Organisation]),
        ScheduleModule.forRoot(),
        ThrottlerModule.forRoot([{
            name: 'default',
            ttl: 60000, // 60 seconds in milliseconds
            limit: 50, // Default limit, can be overridden by guard
        }]),
    ],
    controllers: [LicensingController],
    providers: [
        LicensingService,
        LicensingNotificationsService,
        LicenseUsageService,
        LicenseAuditService,
        LicenseRateLimitGuard,
        {
            provide: Logger,
            useValue: new Logger('LicensingModule'),
        },
        {
            provide: 'APP_FILTER',
            useClass: LicenseExceptionFilter,
        },
    ],
    exports: [LicensingService, LicenseUsageService, LicenseAuditService],
})
export class LicensingModule { } 