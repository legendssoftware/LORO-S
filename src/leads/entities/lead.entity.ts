import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
	OneToMany,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Client } from '../../clients/entities/client.entity';
import { 
	LeadCategory, 
	LeadStatus,
	LeadIntent,
	LeadTemperature,
	LeadSource,
	LeadLifecycleStage,
	BusinessSize,
	Industry,
	DecisionMakerRole,
	CommunicationPreference,
	LeadPriority,
	BudgetRange,
	Timeline
} from '../../lib/enums/lead.enums';
import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Interaction } from 'src/interactions/entities/interaction.entity';

// Define the structure for status history entries
export interface LeadStatusHistoryEntry {
	timestamp: Date;
	oldStatus?: LeadStatus; // Status before the change
	newStatus: LeadStatus; // Status after the change
	reason?: string; // Reason for the change
	description?: string; // Optional description for the change
	nextStep?: string; // Next step for the lead
	userId?: number; // User who made the change (optional)
	user?: User; // Populated user details (name, surname, email, etc.)
}

// Lead scoring components for intelligent lead management
export interface LeadScoringData {
	totalScore: number; // 0-100
	engagementScore: number; // 0-25 - based on interactions, response rates
	demographicScore: number; // 0-25 - based on company size, industry, role
	behavioralScore: number; // 0-25 - based on activity patterns, content engagement
	fitScore: number; // 0-25 - based on budget, timeline, needs match
	lastCalculated: Date;
	scoreHistory: Array<{
		score: number;
		timestamp: Date;
		reason: string;
	}>;
}

// Enhanced lead activity tracking
export interface LeadActivityData {
	lastContactDate?: Date;
	nextFollowUpDate?: Date;
	totalInteractions: number;
	emailInteractions: number;
	phoneInteractions: number;
	meetingInteractions: number;
	averageResponseTime: number; // in hours
	engagementLevel: 'HIGH' | 'MEDIUM' | 'LOW';
	lastEngagementType: string;
	touchPointsCount: number;
	unresponsiveStreak: number; // days without response
}

// BANT qualification tracking
export interface BANTQualification {
	budget: {
		confirmed: boolean;
		range?: BudgetRange;
		notes?: string;
	};
	authority: {
		confirmed: boolean;
		decisionMaker?: boolean;
		role?: DecisionMakerRole;
		influenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
	};
	need: {
		confirmed: boolean;
		painPoints: string[];
		urgency: 'HIGH' | 'MEDIUM' | 'LOW';
		description?: string;
	};
	timeline: {
		confirmed: boolean;
		range?: Timeline;
		specificDate?: Date;
		notes?: string;
	};
	overallQualification: 'QUALIFIED' | 'PARTIALLY_QUALIFIED' | 'UNQUALIFIED' | 'UNKNOWN';
}

// UTM and source tracking
export interface SourceTracking {
	utmSource?: string;
	utmMedium?: string;
	utmCampaign?: string;
	utmTerm?: string;
	utmContent?: string;
	landingPage?: string;
	referralSource?: string;
	firstTouchSource: LeadSource;
	lastTouchSource?: LeadSource;
	touchSourceHistory: Array<{
		source: LeadSource;
		timestamp: Date;
		details?: string;
	}>;
}

// Competitive intelligence
export interface CompetitorData {
	competitorsConsidered: string[];
	currentProvider?: string;
	switchingBarriers: string[];
	competitiveAdvantages: string[];
	lostToCompetitor?: string;
	competitorNotes?: string;
}

@Entity('leads')
export class Lead {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: true })
	name: string;

	@Column({ nullable: true })
	companyName: string;

	@Column({ nullable: true })
	email: string;

	@Column({ nullable: true })
	phone: string;

	@Column({ nullable: true, type: 'enum', enum: LeadCategory, default: LeadCategory.OTHER })
	category: LeadCategory;

	@Column({ nullable: true })
	notes: string;

	@Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.PENDING })
	status: LeadStatus;

	@Column({ type: 'boolean', default: false })
	isDeleted: boolean;

	@Column({ nullable: true })
	image: string;

	@Column({ type: 'json', nullable: true })
	attachments: string[]; // Array of file URLs/paths for documents, PDFs, images, etc.

	@Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
	latitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
	longitude: number;

	// NEW ENHANCED FIELDS FOR INTELLIGENT LEAD MANAGEMENT

	// Core qualification fields
	@Column({ type: 'enum', enum: LeadIntent, nullable: true })
	intent: LeadIntent;

	@Column({ type: 'int', default: 3, comment: 'User-rated lead quality: 1-5 scale' })
	userQualityRating: number;

	@Column({ type: 'enum', enum: LeadTemperature, default: LeadTemperature.COLD })
	temperature: LeadTemperature;

	@Column({ type: 'enum', enum: LeadSource, nullable: true })
	source: LeadSource;

	@Column({ type: 'enum', enum: LeadPriority, default: LeadPriority.MEDIUM })
	priority: LeadPriority;

	@Column({ type: 'enum', enum: LeadLifecycleStage, default: LeadLifecycleStage.LEAD })
	lifecycleStage: LeadLifecycleStage;

	// Company/demographic information
	@Column({ nullable: true })
	jobTitle: string;

	@Column({ type: 'enum', enum: DecisionMakerRole, nullable: true })
	decisionMakerRole: DecisionMakerRole;

	@Column({ type: 'enum', enum: Industry, nullable: true })
	industry: Industry;

	@Column({ type: 'enum', enum: BusinessSize, nullable: true })
	businessSize: BusinessSize;

	@Column({ type: 'enum', enum: BudgetRange, nullable: true })
	budgetRange: BudgetRange;

	@Column({ type: 'enum', enum: Timeline, nullable: true })
	purchaseTimeline: Timeline;

	// Communication preferences
	@Column({ type: 'enum', enum: CommunicationPreference, default: CommunicationPreference.EMAIL })
	preferredCommunication: CommunicationPreference;

	@Column({ nullable: true })
	timezone: string;

	@Column({ nullable: true })
	bestContactTime: string; // e.g., "9:00-17:00"

	// Lead scoring and activity tracking
	@Column({ type: 'int', default: 0, comment: 'Calculated lead score: 0-100' })
	leadScore: number;

	@Column({ type: 'timestamp', nullable: true })
	lastContactDate: Date;

	@Column({ type: 'timestamp', nullable: true })
	nextFollowUpDate: Date;

	@Column({ type: 'int', default: 0 })
	totalInteractions: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, default: 0, comment: 'Average response time in hours' })
	averageResponseTime: number;

	@Column({ type: 'int', default: 0, comment: 'Days since last response' })
	daysSinceLastResponse: number;

	// Business context
	@Column({ type: 'text', nullable: true })
	painPoints: string; // JSON string of pain points array

	@Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
	estimatedValue: number;

	@Column({ nullable: true })
	competitorInfo: string; // Current provider or competitors being considered

	@Column({ nullable: true })
	referralSource: string; // Who referred this lead

	// Campaign and source tracking
	@Column({ nullable: true })
	campaignName: string;

	@Column({ nullable: true })
	landingPage: string;

	@Column({ nullable: true })
	utmSource: string;

	@Column({ nullable: true })
	utmMedium: string;

	@Column({ nullable: true })
	utmCampaign: string;

	@Column({ nullable: true })
	utmTerm: string;

	@Column({ nullable: true })
	utmContent: string;

	// Advanced JSON fields for complex data
	@Column({ type: 'json', nullable: true })
	scoringData: LeadScoringData;

	@Column({ type: 'json', nullable: true })
	activityData: LeadActivityData;

	@Column({ type: 'json', nullable: true })
	bantQualification: BANTQualification;

	@Column({ type: 'json', nullable: true })
	sourceTracking: SourceTracking;

	@Column({ type: 'json', nullable: true })
	competitorData: CompetitorData;

	@Column({ type: 'json', nullable: true })
	customFields: Record<string, any>; // Flexible field for org-specific data

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@ManyToOne(() => User, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'ownerUid' })
	owner: User;

	@Column({ nullable: true })
	ownerUid: number;

	@ManyToOne(() => Organisation, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@ManyToOne(() => Branch, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@Column({ type: 'json', nullable: true })
	assignees: { uid: number }[];

	@ManyToOne(() => Client, (client) => client?.leads)
	client: Client;

	@OneToMany(() => Interaction, (interaction) => interaction.lead)
	interactions: Interaction[];

	@Column({ type: 'json', nullable: true })
	changeHistory: LeadStatusHistoryEntry[];
}
