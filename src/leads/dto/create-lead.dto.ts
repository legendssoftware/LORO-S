import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsArray, IsEnum, IsInt, Min, Max, IsDecimal } from 'class-validator';
import { 
	LeadStatus,
	LeadCategory,
	LeadIntent, 
	LeadTemperature, 
	LeadSource, 
	LeadPriority, 
	LeadLifecycleStage,
	BusinessSize,
	Industry,
	DecisionMakerRole,
	CommunicationPreference,
	BudgetRange,
	Timeline
} from 'src/lib/enums/lead.enums';

export class CreateLeadDto {
	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Full name of the lead',
		example: 'John Doe',
	})
	name?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Company name of the lead',
		example: 'Acme Inc.',
	})
	companyName?: string;

	@IsOptional()
	@IsEmail()
	@ApiProperty({
		description: 'Email of the lead',
		example: 'john.doe@example.com',
	})
	email?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Phone number of the lead',
		example: '+351912345678',
	})
	phone?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Notes of the lead',
		example: 'Some notes about the lead',
	})
	notes?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Image of the lead',
		example: 'https://storage.googleapis.com/bucket/image.jpg',
	})
	image?: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	@ApiProperty({
		description: 'Array of attachment URLs (supports PDFs, images, documents)',
		example: ['https://storage.googleapis.com/bucket/document.pdf', 'https://storage.googleapis.com/bucket/proposal.docx'],
		required: false,
	})
	attachments?: string[];

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Latitude coordinate of the lead',
		example: -33.9249,
	})
	latitude?: number;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Longitude coordinate of the lead',
		example: 18.4241,
	})
	longitude?: number;

	@IsOptional()
	@IsEnum(LeadStatus)
	@ApiProperty({
		description: 'Status of the lead',
		enum: LeadStatus,
		example: LeadStatus.PENDING,
	})
	status?: LeadStatus;

	@IsOptional()
	@IsEnum(LeadCategory)
	@ApiProperty({
		description: 'Category of the lead',
		enum: LeadCategory,
		example: LeadCategory.BUSINESS,
	})
	category?: LeadCategory;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Is deleted of the lead',
		example: false,
	})
	isDeleted?: boolean;

	@IsNotEmpty()
	@IsObject()
	@ApiProperty({
		description: 'The owner reference code of the lead',
		example: { uid: 1 },
	})
	owner: { uid: number };

	@IsNotEmpty()
	@IsObject()
	@ApiProperty({
		example: { uid: 1 },
		description: 'The branch reference code of the lead',
	})
	branch: { uid: number };

	@IsOptional()
	@IsArray()
	@ApiProperty({
		description: 'List of user IDs assigned to this lead',
		example: [{ uid: 1 }, { uid: 2 }],
		required: false,
	})
	assignees?: { uid: number }[];

	@IsOptional()
	@IsObject()
	@ApiProperty({
		description: 'Changes to the lead',
		example: {
			timestamp: '2023-05-15T10:30:00Z',
			oldStatus: 'PENDING',
			newStatus: 'APPROVED',
			reason: 'Client Approval',
			description: 'Met with client on Tuesday, confirmed final details.',
			userId: 1,
		},
	})
	changeHistory?: JSON;

	// NEW ENHANCED FIELDS

	@IsOptional()
	@IsEnum(LeadIntent)
	@ApiProperty({
		description: 'Intent of the lead',
		enum: LeadIntent,
		example: LeadIntent.PURCHASE,
	})
	intent?: LeadIntent;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(5)
	@ApiProperty({
		description: 'User-rated lead quality (1-5 scale)',
		example: 4,
		minimum: 1,
		maximum: 5,
	})
	userQualityRating?: number;

	@IsOptional()
	@IsEnum(LeadTemperature)
	@ApiProperty({
		description: 'Temperature of the lead',
		enum: LeadTemperature,
		example: LeadTemperature.WARM,
	})
	temperature?: LeadTemperature;

	@IsOptional()
	@IsEnum(LeadSource)
	@ApiProperty({
		description: 'Source of the lead',
		enum: LeadSource,
		example: LeadSource.WEBSITE,
	})
	source?: LeadSource;

	@IsOptional()
	@IsEnum(LeadPriority)
	@ApiProperty({
		description: 'Priority of the lead',
		enum: LeadPriority,
		example: LeadPriority.HIGH,
	})
	priority?: LeadPriority;

	@IsOptional()
	@IsEnum(LeadLifecycleStage)
	@ApiProperty({
		description: 'Lifecycle stage of the lead',
		enum: LeadLifecycleStage,
		example: LeadLifecycleStage.MARKETING_QUALIFIED_LEAD,
	})
	lifecycleStage?: LeadLifecycleStage;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Job title of the lead',
		example: 'Marketing Manager',
	})
	jobTitle?: string;

	@IsOptional()
	@IsEnum(DecisionMakerRole)
	@ApiProperty({
		description: 'Decision maker role of the lead',
		enum: DecisionMakerRole,
		example: DecisionMakerRole.MANAGER,
	})
	decisionMakerRole?: DecisionMakerRole;

	@IsOptional()
	@IsEnum(Industry)
	@ApiProperty({
		description: 'Industry of the lead company',
		enum: Industry,
		example: Industry.TECHNOLOGY,
	})
	industry?: Industry;

	@IsOptional()
	@IsEnum(BusinessSize)
	@ApiProperty({
		description: 'Business size of the lead company',
		enum: BusinessSize,
		example: BusinessSize.MEDIUM,
	})
	businessSize?: BusinessSize;

	@IsOptional()
	@IsEnum(BudgetRange)
	@ApiProperty({
		description: 'Budget range of the lead',
		enum: BudgetRange,
		example: BudgetRange.R10K_25K,
	})
	budgetRange?: BudgetRange;

	@IsOptional()
	@IsEnum(Timeline)
	@ApiProperty({
		description: 'Purchase timeline of the lead',
		enum: Timeline,
		example: Timeline.SHORT_TERM,
	})
	purchaseTimeline?: Timeline;

	@IsOptional()
	@IsEnum(CommunicationPreference)
	@ApiProperty({
		description: 'Preferred communication method',
		enum: CommunicationPreference,
		example: CommunicationPreference.EMAIL,
	})
	preferredCommunication?: CommunicationPreference;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Timezone of the lead',
		example: 'Africa/Johannesburg',
	})
	timezone?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Best time to contact the lead',
		example: '9:00-17:00',
	})
	bestContactTime?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Pain points of the lead (JSON string array)',
		example: '["High costs", "Manual processes", "Poor integration"]',
	})
	painPoints?: string;

	@IsOptional()
	@IsNumber()
	@ApiProperty({
		description: 'Estimated value of the lead',
		example: 50000.00,
	})
	estimatedValue?: number;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Current provider or competitor information',
		example: 'Currently using CompetitorX',
	})
	competitorInfo?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Who referred this lead',
		example: 'Jane Smith from NetworkEvent',
	})
	referralSource?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Campaign name that generated this lead',
		example: 'Summer2024-TechSolution',
	})
	campaignName?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'Landing page URL where lead was captured',
		example: 'https://example.com/landing/tech-solution',
	})
	landingPage?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'UTM source parameter',
		example: 'google',
	})
	utmSource?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'UTM medium parameter',
		example: 'cpc',
	})
	utmMedium?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'UTM campaign parameter',
		example: 'summer-tech-2024',
	})
	utmCampaign?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'UTM term parameter',
		example: 'business software',
	})
	utmTerm?: string;

	@IsOptional()
	@IsString()
	@ApiProperty({
		description: 'UTM content parameter',
		example: 'header-cta',
	})
	utmContent?: string;

	@IsOptional()
	@IsObject()
	@ApiProperty({
		description: 'Custom fields for organization-specific data',
		example: { customField1: 'value1', customField2: 'value2' },
	})
	customFields?: Record<string, any>;
}
