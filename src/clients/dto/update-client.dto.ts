import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
	IsEmail,
	IsPhoneNumber,
	IsOptional,
	IsString,
	IsBoolean,
	IsObject,
	ValidateNested,
	IsEnum,
	IsNumber,
	IsDate,
	IsArray,
	Min,
	Max,
	IsInt,
	IsUrl,
	Length,
	Matches,
	IsPositive,
	IsLatitude,
	IsLongitude,
} from 'class-validator';
import { AddressDto, CreateClientDto, SocialProfilesDto } from './create-client.dto';
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

/**
 * UpdateClientDto - Extends CreateClientDto to allow partial updates
 *
 * All fields are optional in this DTO since clients can be updated
 * with only the fields that need to be changed.
 */
export class UpdateClientDto extends PartialType(CreateClientDto) {
	// The PartialType(CreateClientDto) includes all fields from CreateClientDto
	// with each field marked as optional (adds ? to each property).

	// The following fields are already included through PartialType
	// and are only kept here for documentation purposes:

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'ACME Inc.',
		description: 'The name of the client',
	})
	name?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'John Doe',
		description: 'The contact person of the client',
	})
	contactPerson?: string;

	@IsEmail({}, { message: 'Please provide a valid email address' })
	@IsOptional()
	@Transform(({ value }) => value?.toLowerCase().trim())
	@ApiProperty({
		example: 'theguy@example.co.za',
		description: 'The primary email address for the client - must be a valid email format',
		format: 'email'
	})
	email?: string;

	@IsPhoneNumber('ZA', { message: 'Please provide a valid South African phone number with country code (+27)' })
	@IsOptional()
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: '+27 11 123 4567',
		description: 'The primary phone number with South African country code (+27)',
		pattern: '^\\+27\\s?\\d{2}\\s?\\d{3}\\s?\\d{4}$'
	})
	phone?: string;

	@IsPhoneNumber('ZA', { message: 'Alternative phone number must be a valid South African phone number with country code (+27)' })
	@IsOptional()
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: '+27 82 987 6543',
		description: 'Alternative phone number with South African country code (+27)',
		pattern: '^\\+27\\s?\\d{2}\\s?\\d{3}\\s?\\d{4}$'
	})
	alternativePhone?: string;

	@IsUrl({ require_protocol: true }, { message: 'Website must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'https://www.example.co.za',
		description: 'The official website URL of the client - must include protocol (http/https)',
		format: 'uri'
	})
	website?: string;

	@IsUrl({ require_protocol: true }, { message: 'Logo URL must be a valid URL with protocol (http/https)' })
	@IsOptional()
	@Transform(({ value }) => value?.trim())
	@ApiProperty({
		example: 'https://www.example.co.za/logo.png',
		description: 'The URL to the client logo image - must be a valid URL with protocol',
		format: 'uri'
	})
	logo?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'This is a description of the client',
		description: 'The description of the client',
	})
	description?: string;

	@ValidateNested()
	@Type(() => AddressDto)
	@IsOptional()
	@ApiProperty({
		description: 'The full address of the client including coordinates',
		type: AddressDto,
	})
	address?: AddressDto;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'contract',
		description: 'The category of the client',
	})
	category?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'standard',
		description: 'The type of client',
	})
	type?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'active',
		description: 'The status of the client',
	})
	status?: string;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		example: false,
		description: 'Whether the client is deleted',
	})
	isDeleted?: boolean;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: '1234567890',
		description: 'The reference code of the client',
	})
	ref?: string;

	@IsObject()
	@IsOptional()
	@ApiProperty({
		example: { uid: 1 },
		description: 'The assigned sales rep of the client',
	})
	assignedSalesRep?: { uid: number };

	// CRM enhancements
	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: 50000,
		description: 'Credit limit for the client',
	})
	creditLimit?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: 5000,
		description: 'Current outstanding balance',
	})
	outstandingBalance?: number;

	@IsEnum(PriceTier)
	@IsOptional()
	@ApiProperty({
		enum: PriceTier,
		example: PriceTier.STANDARD,
		description: 'The price tier that determines pricing structure for this client',
	})
	priceTier?: PriceTier;

	@IsEnum(ClientContactPreference)
	@IsOptional()
	@ApiProperty({
		enum: ClientContactPreference,
		example: ClientContactPreference.EMAIL,
		description: 'The preferred method of communication',
	})
	preferredContactMethod?: ClientContactPreference;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2023-12-15T10:30:00Z',
		description: 'The date of the last visit or interaction',
	})
	lastVisitDate?: Date;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2024-03-15T14:00:00Z',
		description: 'The date of the next scheduled contact',
	})
	nextContactDate?: Date;

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	@ApiProperty({
		example: ['Electronics', 'Software', 'Services'],
		description: 'Store/Product categories this client can access',
	})
	visibleCategories?: string[];

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	@ApiProperty({
		example: ['VIP', 'Regular', 'Bulk Buyer'],
		description: 'Tags for better client categorization',
	})
	tags?: string[];

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '1985-05-15',
		description: 'Client birthday for sending special offers',
	})
	birthday?: Date;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2020-01-10',
		description: 'Anniversary date (when the client relationship began)',
	})
	anniversaryDate?: Date;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: 250000,
		description: 'Lifetime value of the client',
	})
	lifetimeValue?: number;

	@IsNumber()
	@Min(0)
	@Max(100)
	@IsOptional()
	@ApiProperty({
		example: 10,
		description: 'Discount percentage (if client has a specific discount)',
	})
	discountPercentage?: number;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Net 30',
		description: 'Payment terms for this client',
	})
	paymentTerms?: string;

	@IsEnum(AcquisitionChannel)
	@IsOptional()
	@ApiProperty({
		enum: AcquisitionChannel,
		example: AcquisitionChannel.REFERRAL,
		description: 'How the client was acquired',
	})
	acquisitionChannel?: AcquisitionChannel;

	@IsDate()
	@IsOptional()
	@Type(() => Date)
	@ApiProperty({
		example: '2023-01-15',
		description: 'The date when the client was acquired',
	})
	acquisitionDate?: Date;

	@IsEnum(ClientRiskLevel)
	@IsOptional()
	@ApiProperty({
		enum: ClientRiskLevel,
		example: ClientRiskLevel.LOW,
		description: 'Risk assessment level for this client',
	})
	riskLevel?: ClientRiskLevel;

	@IsEnum(PaymentMethod)
	@IsOptional()
	@ApiProperty({
		enum: PaymentMethod,
		example: PaymentMethod.BANK_TRANSFER,
		description: "Client's preferred payment method",
	})
	preferredPaymentMethod?: PaymentMethod;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'English',
		description: "Client's preferred language for communication",
	})
	preferredLanguage?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		example: 'Technology',
		description: 'The industry sector of the client',
	})
	industry?: string;

	@IsInt()
	@IsOptional()
	@ApiProperty({
		example: 250,
		description: "Number of employees in the client's company",
	})
	companySize?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		example: 5000000,
		description: 'Annual revenue of the client',
	})
	annualRevenue?: number;

	@IsNumber()
	@Min(0)
	@Max(10)
	@IsOptional()
	@ApiProperty({
		example: 9.5,
		description: 'Customer satisfaction score (0-10)',
	})
	satisfactionScore?: number;

	@IsInt()
	@Min(-10)
	@Max(10)
	@IsOptional()
	@ApiProperty({
		example: 8,
		description: 'Net Promoter Score (-10 to 10)',
	})
	npsScore?: number;

	@IsObject()
	@IsOptional()
	@ApiProperty({
		example: { preferredBrand: 'Sony', previousSupplier: 'Samsung' },
		description: 'Custom fields specific to this client',
	})
	customFields?: Record<string, any>;

	@ValidateNested()
	@Type(() => SocialProfilesDto)
	@IsOptional()
	@ApiProperty({
		type: SocialProfilesDto,
		description: 'Social media profiles of the client',
	})
	socialProfiles?: SocialProfilesDto;

	@IsLatitude({ message: 'Latitude must be a valid coordinate between -90 and 90' })
	@IsOptional()
	@Transform(({ value }) => value ? Number(value) : undefined)
	@ApiProperty({
		example: -26.195246,
		description: 'Latitude coordinate for South African location (between -90 and 90)',
		minimum: -90,
		maximum: 90
	})
	latitude?: number;

	@IsLongitude({ message: 'Longitude must be a valid coordinate between -180 and 180' })
	@IsOptional()
	@Transform(({ value }) => value ? Number(value) : undefined)
	@ApiProperty({
		example: 28.034088,
		description: 'Longitude coordinate for South African location (between -180 and 180)',
		minimum: -180,
		maximum: 180
	})
	longitude?: number;

	@IsEnum(GeofenceType)
	@IsOptional()
	@ApiProperty({
		enum: GeofenceType,
		example: GeofenceType.NOTIFY,
		description: 'Geofence type to apply for this client',
	})
	geofenceType?: GeofenceType;

	@IsNumber()
	@IsOptional()
	@Min(100)
	@Max(5000)
	@ApiProperty({
		example: 500,
		description: 'Radius in meters for geofence (default: 500)',
		minimum: 100,
		maximum: 5000,
	})
	geofenceRadius?: number;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		example: true,
		description: 'Enable geofencing for this client',
		default: false,
	})
	enableGeofence?: boolean;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'GPS coordinates of the client location',
		example: '-36.3434314, 149.8488864',
		required: false,
	})
	gpsCoordinates?: string;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateCommunicationScheduleDto)
	@IsOptional()
	@ApiProperty({
		type: [CreateCommunicationScheduleDto],
		description: 'Communication schedules to set up or update for this client',
		required: false,
	})
	communicationSchedules?: CreateCommunicationScheduleDto[];
}
