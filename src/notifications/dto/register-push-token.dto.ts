import { IsString, IsOptional, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterPushTokenDto {
	@ApiProperty({ description: 'Expo push token', example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
	@IsString()
	@IsNotEmpty({ message: 'Push token cannot be empty. Please ensure your device has proper Firebase/FCM configuration for Android or APNs for iOS.' })
	@MinLength(10, { message: 'Push token is too short. Valid Expo push tokens should be at least 50 characters.' })
	@Matches(/^ExponentPushToken\[.+\]$/, { 
		message: 'Invalid push token format. Expected format: ExponentPushToken[...]. If you are on Android, ensure Firebase/FCM is properly configured with google-services.json.' 
	})
	token: string;

	@ApiProperty({ description: 'Device identifier', required: false })
	@IsOptional()
	@IsString()
	deviceId?: string;

	@ApiProperty({ description: 'Platform (ios/android)', required: false, enum: ['ios', 'android'] })
	@IsOptional()
	@IsString()
	platform?: string;
} 