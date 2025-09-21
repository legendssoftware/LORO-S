import { Module, forwardRef } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tracking } from './entities/tracking.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { Geofence } from './entities/geofence.entity';
import { GeofenceEvent } from './entities/geofence-event.entity';
import { GeofenceService } from './geofence.service';
import { GeofenceController } from './geofence.controller';
import { OrganisationModule } from '../organisation/organisation.module';
import { Organisation } from '../organisation/entities/organisation.entity';
import { User } from '../user/entities/user.entity';
import { JwtModule } from '@nestjs/jwt';
import { ReportsModule } from '../reports/reports.module';

@Module({
	imports: [
		LicensingModule,
		OrganisationModule,
		forwardRef(() => ReportsModule),
		TypeOrmModule.forFeature([Tracking, Geofence, GeofenceEvent, Organisation, User]),
		JwtModule.register({
			secret: process.env.JWT_SECRET,
			signOptions: { expiresIn: '8h' },
		}),
	],
	controllers: [TrackingController, GeofenceController],
	providers: [TrackingService, GeofenceService],
	exports: [TrackingService, GeofenceService],
})
export class TrackingModule {}
