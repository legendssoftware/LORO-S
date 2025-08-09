import { ApiProperty } from '@nestjs/swagger';
import {
	IsEmail,
	IsPhoneNumber,
	IsOptional,
	IsString,
	IsNotEmpty,
	IsObject,
	ValidateNested,
	IsEnum,
	IsNumber,
	IsDate,
	IsArray,
	Min,
	Max,
	IsInt,
	IsBoolean,
	IsUrl,
	Length,
	Matches,
	IsPositive,
	IsLatitude,
	IsLongitude,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import {
	ClientContactPreference,
	PriceTier,
	AcquisitionChannel,
	ClientRiskLevel,
	PaymentMethod,
	GeofenceType,
} from '../../lib/enums/client.enums';
import { CreateCommunicationScheduleDto } from './communication-schedule.dto';

export class AddressDto {
	@IsString({ message: 'Street address must be a string' })
	@IsNotEmpty({ message: 'Street address is required' })
	@Length(5, 200, { message: 'Street address must be between 5 and 200 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: '123 Business Park Drive',
		description: 'Street address including house/building number and street name',
		minLength: 5,
		maxLength: 200,
	})
	street: string;

	@IsString({ message: 'Suburb must be a string' })
	@IsNotEmpty({ message: 'Suburb is required' })
	@Length(2, 100, { message: 'Suburb must be between 2 and 100 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'Pretoria South Africa',
		description: 'Suburb or area name',
		minLength: 2,
		maxLength: 100,
	})
	suburb: string;

	@IsString({ message: 'City must be a string' })
	@IsNotEmpty({ message: 'City is required' })
	@Length(2, 100, { message: 'City must be between 2 and 100 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'Pretoria',
		description: 'City name',
		minLength: 2,
		maxLength: 100,
	})
	city: string;

	@IsString({ message: 'State/Province must be a string' })
	@IsNotEmpty({ message: 'State/Province is required' })
	@Length(2, 100, { message: 'State/Province must be between 2 and 100 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'Gauteng',
		description: 'State or province name',
		minLength: 2,
		maxLength: 100,
	})
	state: string;

	@IsString({ message: 'Country must be a string' })
	@IsNotEmpty({ message: 'Country is required' })
	@Length(2, 100, { message: 'Country must be between 2 and 100 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'South Africa',
		description: 'Country name',
		minLength: 2,
		maxLength: 100,
	})
	country: string;

	@IsString({ message: 'Postal code must be a string' })
	@IsNotEmpty({ message: 'Postal code is required' })
	@Matches(/^[0-9]{4}$/, { message: 'South African postal code must be 4 digits' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: '0002',
		description: 'South African postal code (4 digits)',
		pattern: '^[0-9]{4}$',
		minLength: 4,
		maxLength: 4,
	})
	postalCode: string;
}

export class SocialProfilesDto {
	@IsUrl({ require_protocol: true }, { message: 'LinkedIn URL must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@ApiProperty({
		example: 'https://www.linkedin.com/company/loro-corp',
		description: 'LinkedIn profile URL - must be a valid URL with protocol',
	})
	linkedin?: string;

	@IsUrl({ require_protocol: true }, { message: 'Twitter URL must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@ApiProperty({
		example: 'https://twitter.com/loro-corp',
		description: 'Twitter/X profile URL - must be a valid URL with protocol',
	})
	twitter?: string;

	@IsUrl({ require_protocol: true }, { message: 'Facebook URL must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@ApiProperty({
		example: 'https://www.facebook.com/loro.technologies',
		description: 'Facebook page URL - must be a valid URL with protocol',
	})
	facebook?: string;

	@IsUrl({ require_protocol: true }, { message: 'Instagram URL must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@ApiProperty({
		example: 'https://www.instagram.com/loro-corpnologies',
		description: 'Instagram profile URL - must be a valid URL with protocol',
	})
	instagram?: string;
}

export class CreateClientDto {
	@IsString({ message: 'Client name must be a string' })
	@IsNotEmpty({ message: 'Client name is required' })
	@Length(2, 100, { message: 'Client name must be between 2 and 100 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'LORO CORP',
		description: 'The name of the client company or organization',
		minLength: 2,
		maxLength: 100,
	})
	name: string;

	@IsString({ message: 'Contact person must be a string' })
	@IsNotEmpty({ message: 'Contact person is required' })
	@Length(2, 100, { message: 'Contact person name must be between 2 and 100 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'The Guy',
		description: 'The primary contact person at the client organization',
		minLength: 2,
		maxLength: 100,
	})
	contactPerson: string;

	@IsEmail({}, { message: 'Please provide a valid email address' })
	@IsNotEmpty({ message: 'Email address is required' })
	@Transform(({ value }) => value?.toLowerCase().trim())
	@ApiProperty({
		example: 'theguy@example.co.za',
		description: 'The primary email address for the client - must be a valid email format',
		format: 'email',
	})
	email: string;

	@IsPhoneNumber('ZA', { message: 'Please provide a valid South African phone number with country code (+27)' })
	@IsNotEmpty({ message: 'Phone number is required' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: '+27 11 123 4567',
		description: 'The primary phone number with South African country code (+27)',
		pattern: '^\\+27\\s?\\d{2}\\s?\\d{3}\\s?\\d{4}$',
	})
	phone: string;

	@IsPhoneNumber('ZA', {
		message: 'Alternative phone number must be a valid South African phone number with country code (+27)',
	})
	@IsOptional()
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: '+27 82 987 6543',
		description: 'Alternative phone number with South African country code (+27)',
		required: false,
		pattern: '^\\+27\\s?\\d{2}\\s?\\d{3}\\s?\\d{4}$',
	})
	alternativePhone?: string;

	@IsUrl({ require_protocol: true }, { message: 'Website must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'https://www.example.co.za',
		description: 'The official website URL of the client - must include protocol (http/https)',
		required: false,
		format: 'uri',
	})
	website?: string;

	@IsUrl({ require_protocol: true }, { message: 'Logo URL must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'https://www.loro.co.za/logo.png',
		description: 'The URL to the client logo image - must be a valid URL with protocol',
		required: false,
		format: 'uri',
	})
	logo?: string;

	@IsString({ message: 'Description must be a string' })
	@IsOptional()
	@Length(0, 1000, { message: 'Description must not exceed 1000 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'LORO CORP is a leading provider of innovative business solutions in South Africa.',
		description: 'A brief description of the client company and their business activities',
		required: false,
		maxLength: 1000,
	})
	description?: string;

	@ValidateNested()
	@Type(() => AddressDto)
	@IsNotEmpty()
	@ApiProperty({
		description: 'The full address of the client including coordinates',
		type: AddressDto,
	})
	address: AddressDto;

	@IsString({ message: 'Category must be a string' })
	@IsOptional()
	@Length(2, 50, { message: 'Category must be between 2 and 50 characters' })
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'enterprise',
		description: 'The business category of the client (e.g., enterprise, SME, individual)',
		required: false,
		minLength: 2,
		maxLength: 50,
	})
	category?: string;

	@IsObject({ message: 'Assigned sales representative must be an object with uid property' })
	@ValidateNested()
	@IsOptional()
	@ApiProperty({
		example: { uid: 1 },
		description: 'The assigned sales representative of the client',
		required: false,
	})
	assignedSalesRep?: { uid: number };

	// CRM enhancements

	@IsNumber({}, { message: 'Credit limit must be a valid number' })
	@IsPositive({ message: 'Credit limit must be a positive number' })
	@IsOptional()
	@Transform(({ value }) => (value ? Number(value) : undefined))
	@ApiProperty({
		example: 500000,
		description: 'Credit limit for the client in ZAR - must be a positive number',
		required: false,
		minimum: 0,
	})
	creditLimit?: number;

	@IsNumber({}, { message: 'Outstanding balance must be a valid number' })
	@Min(0, { message: 'Outstanding balance cannot be negative' })
	@IsOptional()
	@Transform(({ value }) => (value ? Number(value) : undefined))
	@ApiProperty({
		example: 75000,
		description: 'Current outstanding balance in ZAR - cannot be negative',
		required: false,
		minimum: 0,
	})
	outstandingBalance?: number;

	@IsEnum(PriceTier)
	@IsOptional()
	@ApiProperty({
		enum: PriceTier,
		example: PriceTier.STANDARD,
		description: 'The price tier that determines pricing structure for this client',
		required: false,
	})
	priceTier?: PriceTier;

	@IsEnum(ClientContactPreference)
	@IsOptional()
	@ApiProperty({
		enum: ClientContactPreference,
		example: ClientContactPreference.EMAIL,
		description: 'The preferred method of communication',
		required: false,
	})
	preferredContactMethod?: ClientContactPreference;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2023-12-15T10:30:00Z',
		description: 'The date of the last visit or interaction',
		required: false,
	})
	lastVisitDate?: Date;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2024-03-15T14:00:00Z',
		description: 'The date of the next scheduled contact',
		required: false,
	})
	nextContactDate?: Date;

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	@ApiProperty({
		example: ['Electronics', 'Software', 'Services'],
		description: 'Store/Product categories this client can access',
		required: false,
	})
	visibleCategories?: string[];

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	@ApiProperty({
		example: ['VIP', 'Regular', 'Bulk Buyer'],
		description: 'Tags for better client categorization',
		required: false,
	})
	tags?: string[];

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '1985-05-15',
		description: 'Client birthday for sending special offers',
		required: false,
	})
	birthday?: Date;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2020-01-10',
		description: 'Anniversary date (when the client relationship began)',
		required: false,
	})
	anniversaryDate?: Date;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: 250000,
		description: 'Lifetime value of the client',
		required: false,
	})
	lifetimeValue?: number;

	@IsNumber()
	@Min(0)
	@Max(100)
	@IsOptional()
	@ApiProperty({
		example: 10,
		description: 'Discount percentage (if client has a specific discount)',
		required: false,
	})
	discountPercentage?: number;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Net 30',
		description: 'Payment terms for this client',
		required: false,
	})
	paymentTerms?: string;

	@IsEnum(AcquisitionChannel)
	@IsOptional()
	@ApiProperty({
		enum: AcquisitionChannel,
		example: AcquisitionChannel.REFERRAL,
		description: 'How the client was acquired',
		required: false,
	})
	acquisitionChannel?: AcquisitionChannel;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2023-01-15',
		description: 'The date when the client was acquired',
		required: false,
	})
	acquisitionDate?: Date;

	@IsEnum(ClientRiskLevel)
	@IsOptional()
	@ApiProperty({
		enum: ClientRiskLevel,
		example: ClientRiskLevel.LOW,
		description: 'Risk assessment level for this client',
		required: false,
	})
	riskLevel?: ClientRiskLevel;

	@IsEnum(PaymentMethod)
	@IsOptional()
	@ApiProperty({
		enum: PaymentMethod,
		example: PaymentMethod.BANK_TRANSFER,
		description: "Client's preferred payment method",
		required: false,
	})
	preferredPaymentMethod?: PaymentMethod;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'English',
		description: "Client's preferred language for communication",
		required: false,
	})
	preferredLanguage?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Technology',
		description: 'The industry sector of the client',
		required: false,
	})
	industry?: string;

	@IsInt()
	@IsOptional()
	@ApiProperty({
		example: 250,
		description: "Number of employees in the client's company",
		required: false,
	})
	companySize?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: 5000000,
		description: 'Annual revenue of the client',
		required: false,
	})
	annualRevenue?: number;

	@IsNumber()
	@Min(0)
	@Max(10)
	@IsOptional()
	@ApiProperty({
		example: 9.5,
		description: 'Customer satisfaction score (0-10)',
		required: false,
	})
	satisfactionScore?: number;

	@IsInt()
	@Min(-10)
	@Max(10)
	@IsOptional()
	@ApiProperty({
		example: 8,
		description: 'Net Promoter Score (-10 to 10)',
		required: false,
	})
	npsScore?: number;

	@IsObject()
	@IsOptional()
	@ApiProperty({
		example: { preferredBrand: 'Sony', previousSupplier: 'Samsung' },
		description: 'Custom fields specific to this client',
		required: false,
	})
	customFields?: Record<string, any>;

	@ValidateNested()
	@Type(() => SocialProfilesDto)
	@IsOptional()
	@ApiProperty({
		type: SocialProfilesDto,
		description: 'Social media profiles of the client',
		required: false,
	})
	socialProfiles?: SocialProfilesDto;

	@IsLatitude({ message: 'Latitude must be a valid coordinate between -90 and 90' })
	@IsOptional()
	@Transform(({ value }) => (value ? Number(value) : undefined))
	@ApiProperty({
		example: -26.195246,
		description: 'Latitude coordinate for South African location (between -90 and 90)',
		required: false,
		minimum: -90,
		maximum: 90,
	})
	latitude?: number;

	@IsLongitude({ message: 'Longitude must be a valid coordinate between -180 and 180' })
	@IsOptional()
	@Transform(({ value }) => (value ? Number(value) : undefined))
	@ApiProperty({
		example: 28.034088,
		description: 'Longitude coordinate for South African location (between -180 and 180)',
		required: false,
		minimum: -180,
		maximum: 180,
	})
	longitude?: number;

	@IsEnum(GeofenceType)
	@IsOptional()
	@ApiProperty({
		enum: GeofenceType,
		example: GeofenceType.NOTIFY,
		description: 'Geofence type to apply for this client',
		required: false,
	})
	geofenceType?: GeofenceType;

	@IsNumber()
	@IsOptional()
	@Min(100)
	@Max(5000)
	@ApiProperty({
		example: 500,
		description: 'Radius in meters for geofence (default: 500)',
		required: false,
		minimum: 100,
		maximum: 5000,
	})
	geofenceRadius?: number;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		example: true,
		description: 'Enable geofencing for this client',
		required: false,
		default: false,
	})
	enableGeofence?: boolean;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateCommunicationScheduleDto)
	@IsOptional()
	@ApiProperty({
		type: [CreateCommunicationScheduleDto],
		description: 'Communication schedules to set up for this client',
		required: false,
	})
	communicationSchedules?: CreateCommunicationScheduleDto[];

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		example: true,
		description: 'Whether to send email notification to the client upon account creation. Default is true for automatic notifications.',
		required: false,
		default: true,
	})
	notifyClient?: boolean;
}
