import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class UserSyncClerkDto {
	@ApiProperty({
		description: 'Clerk session token',
		example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
	})
	@IsString({ message: 'Clerk token must be a string' })
	@IsNotEmpty({ message: 'Clerk token is required' })
	clerkToken: string;

	@ApiProperty({
		description: 'Expo push notification token',
		required: false,
		example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
	})
	@IsOptional()
	@IsString()
	expoPushToken?: string;

	@ApiProperty({
		description: 'Device ID for push notifications',
		required: false,
		example: 'device-uuid-123',
	})
	@IsOptional()
	@IsString()
	deviceId?: string;

	@ApiProperty({
		description: 'Platform (ios or android)',
		required: false,
		example: 'ios',
		enum: ['ios', 'android'],
	})
	@IsOptional()
	@IsString()
	platform?: string;
}
