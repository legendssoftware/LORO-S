import { ApiProperty } from '@nestjs/swagger';
import {
	IsString,
	IsNotEmpty,
	IsOptional,
	IsEnum,
	IsBoolean,
	IsNumber,
	IsUrl,
	IsEmail,
	IsDate,
	IsArray,
	ValidateNested,
	IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AddressDto } from 'src/clients/dto/create-client.dto';
import { CompetitorStatus, CompetitorType, GeofenceType } from '../../lib/enums/competitor.enums';

class SocialMediaDto {
	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'LinkedIn profile URL',
		example: 'https://linkedin.com/company/competitor-name',
		required: false,
	})
	linkedin?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Twitter profile URL',
		example: 'https://twitter.com/competitor_name',
		required: false,
	})
	twitter?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Facebook page URL',
		example: 'https://facebook.com/competitorname',
		required: false,
	})
	facebook?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Instagram profile URL',
		example: 'https://instagram.com/competitor_name',
		required: false,
	})
	instagram?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'TikTok profile URL',
		example: 'https://tiktok.com/@competitor_name',
		required: false,
	})
	tiktok?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'YouTube channel URL',
		example: 'https://youtube.com/c/competitor_name',
		required: false,
	})
	youtube?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Snapchat profile URL',
		example: 'https://snapchat.com/add/competitor_name',
		required: false,
	})
	snapchat?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Reddit profile URL',
		example: 'https://reddit.com/u/competitor_name',
		required: false,
	})
	reddit?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Telegram profile URL',
		example: 'https://t.me/competitor_name',
		required: false,
	})
	telegram?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Discord server URL',
		example: 'https://discord.gg/competitor_name',
		required: false,
	})
	discord?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Twitch channel URL',
		example: 'https://twitch.tv/competitor_name',
		required: false,
	})
	twitch?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Pinterest profile URL',
		example: 'https://pinterest.com/competitor_name',
		required: false,
	})
	pinterest?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Medium profile URL',
		example: 'https://medium.com/@competitor_name',
		required: false,
	})
	medium?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'GitHub profile URL',
		example: 'https://github.com/competitor_name',
		required: false,
	})
	github?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Stack Overflow profile URL',
		example: 'https://stackoverflow.com/users/competitor_name',
		required: false,
	})
	stackoverflow?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'GitLab profile URL',
		example: 'https://gitlab.com/competitor_name',
		required: false,
	})
	gitlab?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Bitbucket profile URL',
		example: 'https://bitbucket.org/competitor_name',
		required: false,
	})
	bitbucket?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Dev.to profile URL',
		example: 'https://dev.to/competitor_name',
		required: false,
	})
	devto?: string;
}

class ContactPersonDto {
	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Full name of the contact person',
		example: 'John Doe',
		required: false,
	})
	fullName?: string;

	@IsString()
	@IsOptional()
	@IsEmail()
	@ApiProperty({
		description: 'Email address of the contact person',
		example: 'john.doe@competitor.com',
		required: false,
	})
	email?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Phone number of the contact person',
		example: '+1-123-456-7890',
		required: false,
	})
	phone?: string;
}

class FranchiseHoneyPotDto {
	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'First name for franchise honey pot',
		example: 'John',
		required: false,
	})
	firstName?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Username for franchise honey pot',
		example: 'johndoe',
		required: false,
	})
	username?: string;

	@IsString()
	@IsOptional()
	@IsEmail()
	@ApiProperty({
		description: 'Email for franchise honey pot',
		example: 'john@competitor.com',
		required: false,
	})
	email?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Phone number for franchise honey pot',
		example: '+1-123-456-7890',
		required: false,
	})
	phone?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Password for franchise honey pot',
		example: 'secretPassword123',
		required: false,
	})
	password?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'URL for franchise honey pot',
		example: 'https://franchise.competitor.com',
		required: false,
	})
	url?: string;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Whether private folder is linked',
		example: true,
		required: false,
	})
	pvtFolderLinked?: boolean;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Private folder name',
		example: 'Private Documents',
		required: false,
	})
	pvtFolderName?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Private folder password',
		example: 'folderPassword123',
		required: false,
	})
	pvtFolderPassword?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Private folder username',
		example: 'pvtuser',
		required: false,
	})
	pvtFolderUsername?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Private folder URL',
		example: 'https://private.competitor.com',
		required: false,
	})
	pvtFolderUrl?: string;

	@IsObject()
	@IsOptional()
	@ApiProperty({
		description: 'Activity tracking information',
		example: {
			lastLogin: '2024-01-15T10:30:00Z',
			lastActivity: '2024-01-15T11:45:00Z',
			lastActivityType: 'document_access',
			lastActivityDetails: 'Accessed pricing documents'
		},
		required: false,
	})
	activity?: {
		lastLogin?: Date;
		lastActivity?: Date;
		lastActivityType?: string;
		lastActivityDetails?: string;
	};
}

class PricingDataDto {
	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Low-end pricing',
		example: 99.99,
		required: false,
	})
	lowEndPricing?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Mid-range pricing',
		example: 299.99,
		required: false,
	})
	midRangePricing?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'High-end pricing',
		example: 999.99,
		required: false,
	})
	highEndPricing?: number;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Pricing model',
		example: 'subscription',
		required: false,
	})
	pricingModel?: string;
}

export class CreateCompetitorDto {
	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		description: 'The name of the competitor',
		example: 'Competitor Inc.',
	})
	name: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Description of the competitor company',
		example: 'A major competitor in the enterprise software space',
		required: false,
	})
	description?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Competitor website URL',
		example: 'https://competitor.com',
		required: false,
	})
	website?: string;

	@IsString()
	@IsOptional()
	@IsUrl()
	@ApiProperty({
		description: 'Competitor landing page URL',
		example: 'https://competitor.com/landing',
		required: false,
	})
	landingPage?: string;

	@IsString()
	@IsOptional()
	@IsEmail()
	@ApiProperty({
		description: 'Contact email address',
		example: 'contact@competitor.com',
		required: false,
	})
	contactEmail?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Contact phone number',
		example: '+1-123-456-7890',
		required: false,
	})
	contactPhone?: string;

	@ValidateNested()
	@Type(() => AddressDto)
	@IsNotEmpty()
	@ApiProperty({
		description: 'The full address of the client including coordinates',
		type: AddressDto,
	})
	address: AddressDto;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: "URL to competitor's logo",
		example: 'https://competitor.com/logo.png',
		required: false,
	})
	logoUrl?: string;

	@IsEnum(CompetitorStatus)
	@IsOptional()
	@ApiProperty({
		description: 'Status of the competitor',
		enum: CompetitorStatus,
		example: CompetitorStatus.ACTIVE,
		required: false,
	})
	status?: CompetitorStatus;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Estimated market share percentage',
		example: 12.5,
		required: false,
	})
	marketSharePercentage?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Estimated annual revenue in USD',
		example: 10000000,
		required: false,
	})
	estimatedAnnualRevenue?: number;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Industry',
		example: 'Software',
		required: false,
	})
	industry?: string;

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	@ApiProperty({
		description: 'Key products or services',
		example: ['CRM Software', 'Marketing Automation', 'Support Solutions'],
		isArray: true,
		required: false,
	})
	keyProducts?: string[];

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	@ApiProperty({
		description: 'Key strengths',
		example: ['Strong brand recognition', 'Excellent customer support', 'Robust feature set'],
		isArray: true,
		required: false,
	})
	keyStrengths?: string[];

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	@ApiProperty({
		description: 'Key weaknesses',
		example: ['High pricing', 'Complex user interface', 'Poor mobile support'],
		isArray: true,
		required: false,
	})
	keyWeaknesses?: string[];

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Estimated number of employees',
		example: 5000,
		required: false,
	})
	estimatedEmployeeCount?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Threat level (1-5)',
		example: 4,
		required: false,
		minimum: 1,
		maximum: 5,
	})
	threatLevel?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Competitive advantage level (1-5)',
		example: 3,
		required: false,
		minimum: 1,
		maximum: 5,
	})
	competitiveAdvantage?: number;

	@IsObject()
	@ValidateNested()
	@Type(() => PricingDataDto)
	@IsOptional()
	@ApiProperty({
		description: 'Pricing data and models',
		type: PricingDataDto,
		required: false,
	})
	pricingData?: PricingDataDto;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Business strategy analysis',
		example: 'Focused on enterprise clients with high-touch sales approach',
		required: false,
	})
	businessStrategy?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Marketing strategy analysis',
		example: 'Heavy investment in content marketing and industry events',
		required: false,
	})
	marketingStrategy?: string;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Whether this is a direct competitor',
		example: true,
		required: false,
	})
	isDirect?: boolean;

	@IsDate()
	@IsOptional()
	@ApiProperty({
		description: 'Date when company was founded',
		example: '2010-01-01',
		required: false,
	})
	foundedDate?: Date;

	@IsObject()
	@ValidateNested()
	@Type(() => SocialMediaDto)
	@IsOptional()
	@ApiProperty({
		description: 'Social media profiles',
		type: SocialMediaDto,
		required: false,
	})
	socialMedia?: SocialMediaDto;

	@IsEnum(CompetitorType)
	@IsOptional()
	@ApiProperty({
		description: 'Type of competitor',
		enum: CompetitorType,
		example: CompetitorType.DIRECT,
		required: false,
	})
	competitorType?: CompetitorType;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Organisation ID this competitor belongs to',
		example: 1,
		required: false,
	})
	organisationId?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Branch ID this competitor belongs to',
		example: 1,
		required: false,
	})
	branchId?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Latitude coordinate',
		example: 51.5074,
		required: false,
	})
	latitude?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Longitude coordinate',
		example: -0.1278,
		required: false,
	})
	longitude?: number;

	@IsEnum(GeofenceType)
	@IsOptional()
	@ApiProperty({
		description: 'Geofence type to apply for this competitor',
		enum: GeofenceType,
		example: GeofenceType.NOTIFY,
		required: false,
	})
	geofenceType?: GeofenceType;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Radius in meters for geofence (default: 500)',
		example: 500,
		required: false,
		minimum: 100,
		maximum: 5000,
	})
	geofenceRadius?: number;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Enable geofencing for this competitor',
		example: true,
		required: false,
		default: false,
	})
	enableGeofence?: boolean;

	// New update fields
	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Account name for the competitor',
		example: 'Competitor Account',
		required: false,
	})
	accountName?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Business Development Manager',
		example: 'John Smith',
		required: false,
	})
	BDM?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Legal entity name',
		example: 'Competitor Inc.',
		required: false,
	})
	LegalEntity?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Trading name',
		example: 'Competitor Trading',
		required: false,
	})
	TradingName?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Member level',
		example: 'Gold',
		required: false,
	})
	MemberLevel?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Memberships',
		example: 'Industry Association',
		required: false,
	})
	MemberShips?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Brand status',
		example: 'Active',
		required: false,
	})
	brandStatus?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Primary bank',
		example: 'Standard Bank',
		required: false,
	})
	bank?: string;

	@IsObject()
	@ValidateNested()
	@Type(() => ContactPersonDto)
	@IsOptional()
	@ApiProperty({
		description: 'Owner contact information',
		type: ContactPersonDto,
		required: false,
	})
	owners?: ContactPersonDto;

	@IsObject()
	@ValidateNested()
	@Type(() => ContactPersonDto)
	@IsOptional()
	@ApiProperty({
		description: 'Manager contact information',
		type: ContactPersonDto,
		required: false,
	})
	managers?: ContactPersonDto;

	@IsObject()
	@ValidateNested()
	@Type(() => ContactPersonDto)
	@IsOptional()
	@ApiProperty({
		description: 'Purchase manager contact information',
		type: ContactPersonDto,
		required: false,
	})
	purchaseManagers?: ContactPersonDto;

	@IsObject()
	@ValidateNested()
	@Type(() => ContactPersonDto)
	@IsOptional()
	@ApiProperty({
		description: 'Account manager contact information',
		type: ContactPersonDto,
		required: false,
	})
	accountManagers?: ContactPersonDto;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Company registration number',
		example: '2021/123456/07',
		required: false,
	})
	companyRegNumber?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'VAT number',
		example: '4123456789',
		required: false,
	})
	vatNumber?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Chief Revenue Officer',
		example: 'Jane Doe',
		required: false,
	})
	CRO?: string;

	@IsString()
	@IsOptional()
	@IsEmail()
	@ApiProperty({
		description: 'Franchise contact email',
		example: 'franchise@competitor.com',
		required: false,
	})
	franchiseEmail?: string;

	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Franchise contact phone',
		example: '+27-11-123-4567',
		required: false,
	})
	franchisePhone?: string;

	@IsObject()
	@ValidateNested()
	@Type(() => FranchiseHoneyPotDto)
	@IsOptional()
	@ApiProperty({
		description: 'Franchise honey pot information',
		type: FranchiseHoneyPotDto,
		required: false,
	})
	franchiseHoneyPot?: FranchiseHoneyPotDto;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Online visibility marketing score (0-100)',
		example: 75,
		required: false,
		minimum: 0,
		maximum: 100,
	})
	onlineVisibilityMKTG?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Online visibility SEO score (0-100)',
		example: 80,
		required: false,
		minimum: 0,
		maximum: 100,
	})
	onlineVisibilitySEO?: number;

	@IsNumber()
	@IsOptional()
	@ApiProperty({
		description: 'Online visibility social media score (0-100)',
		example: 65,
		required: false,
		minimum: 0,
		maximum: 100,
	})
	onlineVisibilitySocial?: number;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Whether competitor has a loyalty program',
		example: true,
		required: false,
	})
	hasLoyaltyProgram?: boolean;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Whether competitor has a rewards program',
		example: false,
		required: false,
	})
	hasRewardsProgram?: boolean;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Whether competitor has a referral program',
		example: true,
		required: false,
	})
	hasReferralProgram?: boolean;
}
