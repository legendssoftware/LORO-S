import { IsString, IsOptional, IsObject, IsBoolean, IsNumber, IsEnum, IsArray, IsEmail, IsUrl, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ContactDto {
	@ApiProperty({ 
		description: 'Primary contact email for the organization',
		required: false,
		example: 'contact@acmecorp.com'
	})
	@IsString()
	@IsOptional()
	email?: string;

	@ApiProperty({ 
		description: 'Contact phone number with country code and number',
		required: false,
		example: {
			code: '+1',
			number: '5551234567'
		}
	})
	@IsObject()
	@IsOptional()
	phone?: {
		code: string;
		number: string;
	};

	@ApiProperty({ 
		description: 'Official website URL of the organization',
		required: false,
		example: 'https://www.acmecorp.com'
	})
	@IsString()
	@IsOptional()
	website?: string;

	@ApiProperty({ 
		description: 'Physical address of the organization',
		required: false,
		example: {
			street: '123 Innovation Drive, Suite 400',
			suburb: 'Tech District',
			city: 'San Francisco',
			state: 'CA',
			country: 'US',
			postalCode: '94107'
		}
	})
	@IsObject()
	@IsOptional()
	address?: {
		street: string;
		suburb?: string;
		city: string;
		state: string;
		country: string;
		postalCode: string;
	};
}

export class RegionalDto {
	@ApiProperty({ 
		description: 'Primary language used by the organization (ISO code)',
		required: false,
		example: 'en-ZA'
	})
	@IsString()
	@IsOptional()
	language?: string;

	@ApiProperty({ 
		description: 'Organization\'s operating timezone (IANA format)',
		required: false,
		example: 'America/Los_Angeles'
	})
	@IsString()
	@IsOptional()
	timezone?: string;

	@ApiProperty({ 
		description: 'Primary currency used by the organization (ISO code)',
		required: false,
		example: 'USD'
	})
	@IsString()
	@IsOptional()
	currency?: string;

	@ApiProperty({ 
		description: 'Preferred date format for the organization',
		required: false,
		example: 'MM/DD/YYYY'
	})
	@IsString()
	@IsOptional()
	dateFormat?: string;

	@ApiProperty({ 
		description: 'Preferred time format (12/24 hour)',
		required: false,
		example: 'HH:mm A'
	})
	@IsString()
	@IsOptional()
	timeFormat?: string;
}

export class BrandingDto {
	@ApiProperty({ 
		description: 'URL to the organization\'s primary logo (high resolution)',
		required: false,
		example: 'https://storage.googleapis.com/acmecorp-assets/logo-full.png'
	})
	@IsString()
	@IsOptional()
	logo?: string;

	@ApiProperty({ 
		description: 'Alternative text for the logo for accessibility',
		required: false,
		example: 'ACME Corporation - Building the Future'
	})
	@IsString()
	@IsOptional()
	logoAltText?: string;

	@ApiProperty({ 
		description: 'URL to the organization\'s favicon',
		required: false,
		example: 'https://storage.googleapis.com/acmecorp-assets/favicon.ico'
	})
	@IsString()
	@IsOptional()
	favicon?: string;

	@ApiProperty({ 
		description: 'Primary brand color in hexadecimal format',
		required: false,
		example: '#4285F4'
	})
	@IsString()
	@IsOptional()
	primaryColor?: string;

	@ApiProperty({ 
		description: 'Secondary brand color in hexadecimal format',
		required: false,
		example: '#34A853'
	})
	@IsString()
	@IsOptional()
	secondaryColor?: string;

	@ApiProperty({ 
		description: 'Accent brand color in hexadecimal format',
		required: false,
		example: '#EA4335'
	})
	@IsString()
	@IsOptional()
	accentColor?: string;
}

export class BusinessDto {
	@ApiProperty({ 
		description: 'Official registered business name',
		required: false,
		example: 'ACME Corporation, Inc.'
	})
	@IsString()
	@IsOptional()
	name?: string;

	@ApiProperty({ 
		description: 'Business registration or incorporation number',
		required: false,
		example: 'DE-C4356782'
	})
	@IsString()
	@IsOptional()
	registrationNumber?: string;

	@ApiProperty({ 
		description: 'Tax identification number or VAT ID',
		required: false,
		example: '47-1234567'
	})
	@IsString()
	@IsOptional()
	taxId?: string;

	@ApiProperty({ 
		description: 'Primary industry sector the organization operates in',
		required: false,
		example: 'Information Technology & Services'
	})
	@IsString()
	@IsOptional()
	industry?: string;

	@ApiProperty({ 
		description: 'Size of the organization by number of employees',
		required: false,
		enum: ['small', 'medium', 'large', 'enterprise'],
		example: 'medium'
	})
	@IsEnum(['small', 'medium', 'large', 'enterprise'])
	@IsOptional()
	size?: 'small' | 'medium' | 'large' | 'enterprise';
}

export class NotificationsDto {
	@ApiProperty({ 
		description: 'Whether to enable email notifications for the organization',
		required: false,
		example: true
	})
	@IsBoolean()
	@IsOptional()
	email?: boolean;

	@ApiProperty({ 
		description: 'Whether to enable SMS notifications for the organization',
		required: false,
		example: false
	})
	@IsBoolean()
	@IsOptional()
	sms?: boolean;

	@ApiProperty({ 
		description: 'Whether to enable push notifications for the organization',
		required: false,
		example: true
	})
	@IsBoolean()
	@IsOptional()
	push?: boolean;

	@ApiProperty({ 
		description: 'Whether to enable WhatsApp notifications for the organization',
		required: false,
		example: false
	})
	@IsBoolean()
	@IsOptional()
	whatsapp?: boolean;
}

export class PreferencesDto {
	@ApiProperty({ 
		description: 'Default view to show when users log in',
		required: false,
		example: 'dashboard'
	})
	@IsString()
	@IsOptional()
	defaultView?: string;

	@ApiProperty({ 
		description: 'Number of items to show per page in lists',
		required: false,
		example: 25
	})
	@IsNumber()
	@IsOptional()
	itemsPerPage?: number;

	@ApiProperty({ 
		description: 'Default UI theme preference',
		required: false,
		enum: ['light', 'dark', 'system'],
		example: 'system'
	})
	@IsEnum(['light', 'dark', 'system'])
	@IsOptional()
	theme?: 'light' | 'dark' | 'system';

	@ApiProperty({ 
		description: 'Whether the navigation menu should be collapsed by default',
		required: false,
		example: false
	})
	@IsBoolean()
	@IsOptional()
	menuCollapsed?: boolean;
}

export class CustomSocialLinkDto {
	@ApiProperty({
		description: 'Name of the custom social platform',
		example: 'TikTok',
	})
	@IsString()
	name: string;

	@ApiProperty({
		description: 'URL of the social media profile',
		example: 'https://tiktok.com/@company',
	})
	@IsUrl()
	url: string;

	@ApiProperty({
		description: 'Optional icon for the social platform',
		required: false,
		example: 'tiktok-icon',
	})
	@IsString()
	@IsOptional()
	icon?: string;
}

export class SocialLinksDto {
	@ApiProperty({
		description: 'Facebook page URL',
		required: false,
		example: 'https://facebook.com/company',
	})
	@IsUrl()
	@IsOptional()
	facebook?: string;

	@ApiProperty({
		description: 'Twitter profile URL',
		required: false,
		example: 'https://twitter.com/company',
	})
	@IsUrl()
	@IsOptional()
	twitter?: string;

	@ApiProperty({
		description: 'Instagram profile URL',
		required: false,
		example: 'https://instagram.com/company',
	})
	@IsUrl()
	@IsOptional()
	instagram?: string;

	@ApiProperty({
		description: 'LinkedIn company page URL',
		required: false,
		example: 'https://linkedin.com/company/company-name',
	})
	@IsUrl()
	@IsOptional()
	linkedin?: string;

	@ApiProperty({
		description: 'YouTube channel URL',
		required: false,
		example: 'https://youtube.com/c/company',
	})
	@IsUrl()
	@IsOptional()
	youtube?: string;

	@ApiProperty({
		description: 'Company website URL',
		required: false,
		example: 'https://company.com',
	})
	@IsUrl()
	@IsOptional()
	website?: string;

	@ApiProperty({
		type: [CustomSocialLinkDto],
		description: 'Custom social media links',
		required: false,
		example: [
			{
				name: 'TikTok',
				url: 'https://tiktok.com/@company',
				icon: 'tiktok',
			},
		],
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CustomSocialLinkDto)
	@IsOptional()
	custom?: CustomSocialLinkDto[];
}

export class CreateOrganisationSettingsDto {
	@ApiProperty({
		type: ContactDto,
		required: false,
		description: 'Contact information for the organization',
		example: {
			email: 'contact@acmecorp.com',
			phone: {
				code: '+1',
				number: '5551234567',
			},
			website: 'https://www.acmecorp.com',
			address: {
				street: '123 Innovation Drive, Suite 400',
				suburb: 'Tech District',
				city: 'San Francisco',
				state: 'CA',
				country: 'US',
				postalCode: '94107'
			},
		},
	})
	@IsObject()
	@IsOptional()
	contact?: ContactDto;

	@ApiProperty({
		type: RegionalDto,
		required: false,
		description: 'Regional and localization preferences for the organization',
		example: {
			language: 'en-ZA',
			timezone: 'America/Los_Angeles',
			currency: 'USD',
			dateFormat: 'MM/DD/YYYY',
			timeFormat: 'HH:mm A',
		},
	})
	@IsObject()
	@IsOptional()
	regional?: RegionalDto;

	@ApiProperty({
		type: BrandingDto,
		required: false,
		description: 'Organization branding and visual identity settings',
		example: {
			logo: 'https://storage.googleapis.com/acmecorp-assets/logo-full.png',
			logoAltText: 'ACME Corporation - Building the Future',
			favicon: 'https://storage.googleapis.com/acmecorp-assets/favicon.ico',
			primaryColor: '#4285F4',
			secondaryColor: '#34A853',
			accentColor: '#EA4335',
		},
	})
	@IsObject()
	@IsOptional()
	branding?: BrandingDto;

	@ApiProperty({
		type: BusinessDto,
		required: false,
		description: 'Legal business information for the organization',
		example: {
			name: 'ACME Corporation, Inc.',
			registrationNumber: 'DE-C4356782',
			taxId: '47-1234567',
			industry: 'Information Technology & Services',
			size: 'medium',
		},
	})
	@IsObject()
	@IsOptional()
	business?: BusinessDto;

	@ApiProperty({
		type: NotificationsDto,
		required: false,
		description: 'Notification channel preferences for the organization',
		example: {
			email: true,
			sms: false,
			push: true,
			whatsapp: false,
		},
	})
	@IsObject()
	@IsOptional()
	notifications?: NotificationsDto;

	@ApiProperty({
		type: PreferencesDto,
		required: false,
		description: 'User interface and experience preferences for the organization',
		example: {
			defaultView: 'dashboard',
			itemsPerPage: 25,
			theme: 'system',
			menuCollapsed: false,
		},
	})
	@IsObject()
	@IsOptional()
	preferences?: PreferencesDto;

	@ApiProperty({
		description: 'Whether to send email notifications to clients when tasks are completed',
		required: false,
		default: false,
		example: true,
	})
	@IsBoolean()
	@IsOptional()
	sendTaskNotifications?: boolean;

	@ApiProperty({
		description: 'Number of days feedback tokens are valid before expiring (default: 30)',
		required: false,
		default: 30,
		example: 30,
	})
	@IsNumber()
	@IsOptional()
	feedbackTokenExpiryDays?: number;

	@ApiProperty({
		type: SocialLinksDto,
		required: false,
		description: 'Social media links for the organization',
		example: {
			facebook: 'https://facebook.com/company',
			twitter: 'https://twitter.com/company',
			linkedin: 'https://linkedin.com/company/company-name',
			website: 'https://company.com',
			custom: [
				{
					name: 'TikTok',
					url: 'https://tiktok.com/@company',
					icon: 'tiktok',
				},
			],
		},
	})
	@IsObject()
	@ValidateNested()
	@Type(() => SocialLinksDto)
	@IsOptional()
	socialLinks?: SocialLinksDto;
}
