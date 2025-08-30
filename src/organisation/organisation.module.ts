import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganisationController } from './organisation.controller';
import { OrganisationService } from './organisation.service';
import { Organisation } from './entities/organisation.entity';
import { OrganisationSettings } from './entities/organisation-settings.entity';
import { OrganisationAppearance } from './entities/organisation-appearance.entity';
import { OrganisationHours } from './entities/organisation-hours.entity';
import { OrganisationSettingsController } from './controllers/organisation-settings.controller';
import { OrganisationHoursController } from './controllers/organisation-hours.controller';
import { OrganisationSettingsService } from './services/organisation-settings.service';
import { OrganisationAppearanceService } from './services/organisation-appearance.service';
import { OrganisationHoursService } from './services/organisation-hours.service';
import { OrganisationAppearanceController } from './controllers/organisation-appearance.controller';
import { LicensingModule } from '../licensing/licensing.module';

@Module({
    imports: [
        LicensingModule,
        TypeOrmModule.forFeature([
            Organisation,
            OrganisationSettings,
            OrganisationAppearance,
            OrganisationHours,
        ]),
    ],
    controllers: [
        OrganisationController,
        OrganisationSettingsController,
        OrganisationAppearanceController, 
        OrganisationHoursController,
    ],
    providers: [
        OrganisationService,
        OrganisationSettingsService,
        OrganisationAppearanceService,
        OrganisationHoursService,
    ],
    exports: [OrganisationService, OrganisationHoursService],
})
export class OrganisationModule {}
