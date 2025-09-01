import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../user/user.module';
import { RewardsModule } from '../rewards/rewards.module';
import { PendingSignupService } from './pending-signup.service';
import { PasswordResetService } from './password-reset.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PendingSignup } from './entities/pending-signup.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { LicensingModule } from '../licensing/licensing.module';
import { ClientAuthService } from './client-auth.service';
import { ClientAuthController } from './client-auth.controller';
import { ClientPasswordReset } from './entities/client-password-reset.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { ClientJwtAuthGuard } from '../guards/client-jwt-auth.guard';
import { PlatformService } from '../lib/services/platform.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            PendingSignup, 
            PasswordReset, 
            ClientPasswordReset, 
            ClientAuth
        ]),
        JwtModule.register({
            global: true,
            secret: 'K9HXmP$2vL5nR8qY3wZ7jB4cF6hN9kM@pT2xS5vA8dG4jE7mQ9nU',
            signOptions: { expiresIn: '1h' },
        }),
        UserModule,
        RewardsModule,
        LicensingModule,
        NotificationsModule,
    ],
    controllers: [AuthController, ClientAuthController],
    providers: [
        AuthService, 
        PendingSignupService, 
        PasswordResetService,
        ClientAuthService,
        ClientJwtAuthGuard,
        PlatformService
    ],
    exports: [AuthService, ClientAuthService, ClientJwtAuthGuard],
})
export class AuthModule { }
