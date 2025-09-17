import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsBoolean, IsString } from 'class-validator';
import { Theme, Language, NotificationFrequency, DateFormat, TimeFormat } from '../../lib/enums/user.enums';

export class CreateUserPreferencesDto {
	@IsOptional()
	@IsEnum(Theme)
	@ApiProperty({
		description: 'Theme preference for the user interface',
		enum: Theme,
		example: Theme.LIGHT,
		required: false,
	})
	theme?: Theme;

	@IsOptional()
	@IsEnum(Language)
	@ApiProperty({
		description: 'Language preference for the user interface',
		enum: Language,
		example: Language.ENGLISH,
		required: false,
	})
	language?: Language;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Enable or disable push notifications',
		example: true,
		required: false,
	})
	notifications?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Enable automatic shift end when leaving work location',
		example: false,
		required: false,
	})
	shiftAutoEnd?: boolean;

	@IsOptional()
	@IsEnum(NotificationFrequency)
	@ApiProperty({
		description: 'Frequency of notification delivery',
		enum: NotificationFrequency,
		example: NotificationFrequency.REAL_TIME,
		required: false,
	})
	notificationFrequency?: NotificationFrequency;

	@IsOptional()
	@IsEnum(DateFormat)
	@ApiProperty({
		description: 'Preferred date format for display',
		enum: DateFormat,
		example: DateFormat.DD_MM_YYYY,
		required: false,
	})
	dateFormat?: DateFormat;

	@IsOptional()
	@IsEnum(TimeFormat)
	@ApiProperty({
		description: 'Preferred time format for display',
		enum: TimeFormat,
		example: TimeFormat.TWENTY_FOUR_HOUR,
		required: false,
	})
	timeFormat?: TimeFormat;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Enable email notifications',
		example: true,
		required: false,
	})
	emailNotifications?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Enable SMS notifications',
		example: false,
		required: false,
	})
	smsNotifications?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Enable biometric authentication if available',
		example: true,
		required: false,
	})
	biometricAuth?: boolean;

	@IsOptional()
	@IsBoolean()
	@ApiProperty({
		description: 'Show advanced features in the interface',
		example: false,
		required: false,
	})
	advancedFeatures?: boolean;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Preferred timezone for displaying dates and times',
		example: 'Africa/Johannesburg',
		required: false,
	})
	timezone?: string;
}
