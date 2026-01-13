import { parse } from 'csv-parse/sync';
import {
	LeadSource,
	Industry,
	BudgetRange,
	LeadStatus,
	LeadCategory,
	LeadIntent,
	LeadTemperature,
	LeadPriority,
	LeadLifecycleStage,
	DecisionMakerRole,
	BusinessSize,
	Timeline,
	CommunicationPreference,
} from '../../lib/enums/lead.enums';

export interface ParsedLeadRow {
	// Basic fields
	name?: string;
	email?: string;
	phone?: string;
	companyName: string;
	notes?: string;
	image?: string;
	attachments?: string[];
	latitude?: number;
	longitude?: number;
	category?: LeadCategory;
	status?: LeadStatus;

	// Enhanced qualification fields
	intent?: LeadIntent;
	userQualityRating?: number;
	temperature?: LeadTemperature;
	source?: LeadSource;
	priority?: LeadPriority;
	lifecycleStage?: LeadLifecycleStage;

	// Company/demographic information
	jobTitle?: string;
	decisionMakerRole?: DecisionMakerRole;
	industry?: Industry;
	businessSize?: BusinessSize;
	budgetRange?: BudgetRange;
	purchaseTimeline?: Timeline;

	// Communication preferences
	preferredCommunication?: CommunicationPreference;
	timezone?: string;
	bestContactTime?: string;

	// Business context
	painPoints?: string; // JSON string array
	estimatedValue?: number;
	competitorInfo?: string;
	referralSource?: string;

	// Campaign and source tracking
	campaignName?: string;
	landingPage?: string;
	utmSource?: string;
	utmMedium?: string;
	utmCampaign?: string;
	utmTerm?: string;
	utmContent?: string;

	// Custom fields
	customFields?: Record<string, any>;
}

export interface CSVParseResult {
	leads: ParsedLeadRow[];
	errors: Array<{ row: number; error: string }>;
}

/**
 * Normalize enum value: uppercase and replace spaces with underscores
 */
function normalizeEnumValue(value: string): string {
	return value.toUpperCase().replace(/\s+/g, '_');
}

/**
 * Validate and normalize enum value against enum object
 */
function validateEnum<T extends Record<string, string>>(
	value: string,
	enumObject: T,
	fieldName: string,
): T[keyof T] | null {
	if (!value || value.trim() === '') {
		return null;
	}
	const normalized = normalizeEnumValue(value.trim());
	const validValue = Object.values(enumObject).find(
		(v) => v === normalized,
	) as T[keyof T] | undefined;
	return validValue || null;
}

/**
 * Parse comma-separated string to array
 */
function parseCommaSeparated(value: string): string[] {
	if (!value || value.trim() === '') {
		return [];
	}
	return value
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item !== '');
}

/**
 * Parse comma-separated values to JSON string array
 */
function parsePainPoints(value: string): string | undefined {
	if (!value || value.trim() === '') {
		return undefined;
	}
	const points = parseCommaSeparated(value);
	if (points.length === 0) {
		return undefined;
	}
	return JSON.stringify(points);
}

/**
 * Parse JSON string to object
 */
function parseJSON(value: string): Record<string, any> | undefined {
	if (!value || value.trim() === '') {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value.trim());
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
			return parsed;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Parse numeric value with validation
 */
function parseNumber(value: string, fieldName: string): number | undefined {
	if (!value || value.trim() === '') {
		return undefined;
	}
	const num = parseFloat(value.trim());
	if (isNaN(num)) {
		return undefined;
	}
	return num;
}

/**
 * Parse integer value with validation
 */
function parseInteger(value: string, min?: number, max?: number): number | undefined {
	if (!value || value.trim() === '') {
		return undefined;
	}
	const num = parseInt(value.trim(), 10);
	if (isNaN(num)) {
		return undefined;
	}
	if (min !== undefined && num < min) {
		return undefined;
	}
	if (max !== undefined && num > max) {
		return undefined;
	}
	return num;
}

/**
 * Parse CSV buffer into lead data
 */
export function parseCSV(buffer: Buffer): CSVParseResult {
	const errors: Array<{ row: number; error: string }> = [];
	const leads: ParsedLeadRow[] = [];

	try {
		// Parse CSV with headers
		const records = parse(buffer.toString(), {
			columns: true,
			skip_empty_lines: true,
			trim: true,
			relax_column_count: true,
		});

		records.forEach((record: any, index: number) => {
			const rowNumber = index + 2; // +2 because index is 0-based and we skip header row

			try {
				// Validate required fields
				const hasName = record.name && record.name.trim() !== '';
				const hasEmail = record.email && record.email.trim() !== '';
				const hasPhone = record.phone && record.phone.trim() !== '';
				const hasCompanyName = record.companyName && record.companyName.trim() !== '';

				// At least name OR (email OR phone) + companyName required
				if (!hasCompanyName) {
					errors.push({
						row: rowNumber,
						error: 'Missing required field: companyName',
					});
					return;
				}

				if (!hasName && !hasEmail && !hasPhone) {
					errors.push({
						row: rowNumber,
						error: 'Missing required field: name OR (email OR phone)',
					});
					return;
				}

				// Build lead object
				const lead: ParsedLeadRow = {
					companyName: record.companyName.trim(),
				};

				// Basic fields
				if (hasName) {
					lead.name = record.name.trim();
				}

				if (hasEmail) {
					// Basic email validation
					const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
					if (emailRegex.test(record.email.trim())) {
						lead.email = record.email.trim();
					} else {
						errors.push({
							row: rowNumber,
							error: `Invalid email format: ${record.email}`,
						});
						return;
					}
				}

				if (hasPhone) {
					lead.phone = record.phone.trim();
				}

				if (record.notes && record.notes.trim() !== '') {
					lead.notes = record.notes.trim();
				}

				if (record.image && record.image.trim() !== '') {
					lead.image = record.image.trim();
				}

				// Parse attachments (comma-separated)
				if (record.attachments && record.attachments.trim() !== '') {
					lead.attachments = parseCommaSeparated(record.attachments);
				}

				// Parse numeric fields
				if (record.latitude) {
					const lat = parseNumber(record.latitude, 'latitude');
					if (lat !== undefined) {
						lead.latitude = lat;
					}
				}

				if (record.longitude) {
					const lng = parseNumber(record.longitude, 'longitude');
					if (lng !== undefined) {
						lead.longitude = lng;
					}
				}

				if (record.estimatedValue) {
					const value = parseNumber(record.estimatedValue, 'estimatedValue');
					if (value !== undefined) {
						lead.estimatedValue = value;
					}
				}

				if (record.userQualityRating) {
					const rating = parseInteger(record.userQualityRating, 1, 5);
					if (rating !== undefined) {
						lead.userQualityRating = rating;
					}
				}

				// Parse enum fields
				if (record.category) {
					const category = validateEnum(record.category, LeadCategory, 'category');
					if (category) {
						lead.category = category;
					}
				}

				if (record.status) {
					const status = validateEnum(record.status, LeadStatus, 'status');
					if (status) {
						lead.status = status;
					}
				}

				if (record.intent) {
					const intent = validateEnum(record.intent, LeadIntent, 'intent');
					if (intent) {
						lead.intent = intent;
					}
				}

				if (record.temperature) {
					const temperature = validateEnum(record.temperature, LeadTemperature, 'temperature');
					if (temperature) {
						lead.temperature = temperature;
					}
				}

				if (record.source) {
					const source = validateEnum(record.source, LeadSource, 'source');
					if (source) {
						lead.source = source;
					}
				}

				if (record.priority) {
					const priority = validateEnum(record.priority, LeadPriority, 'priority');
					if (priority) {
						lead.priority = priority;
					}
				}

				if (record.lifecycleStage) {
					const lifecycleStage = validateEnum(record.lifecycleStage, LeadLifecycleStage, 'lifecycleStage');
					if (lifecycleStage) {
						lead.lifecycleStage = lifecycleStage;
					}
				}

				if (record.jobTitle && record.jobTitle.trim() !== '') {
					lead.jobTitle = record.jobTitle.trim();
				}

				if (record.decisionMakerRole) {
					const role = validateEnum(record.decisionMakerRole, DecisionMakerRole, 'decisionMakerRole');
					if (role) {
						lead.decisionMakerRole = role;
					}
				}

				if (record.industry) {
					const industry = validateEnum(record.industry, Industry, 'industry');
					if (industry) {
						lead.industry = industry;
					}
				}

				if (record.businessSize) {
					const businessSize = validateEnum(record.businessSize, BusinessSize, 'businessSize');
					if (businessSize) {
						lead.businessSize = businessSize;
					}
				}

				if (record.budgetRange) {
					const budgetRange = validateEnum(record.budgetRange, BudgetRange, 'budgetRange');
					if (budgetRange) {
						lead.budgetRange = budgetRange;
					}
				}

				if (record.purchaseTimeline) {
					const timeline = validateEnum(record.purchaseTimeline, Timeline, 'purchaseTimeline');
					if (timeline) {
						lead.purchaseTimeline = timeline;
					}
				}

				if (record.preferredCommunication) {
					const comm = validateEnum(record.preferredCommunication, CommunicationPreference, 'preferredCommunication');
					if (comm) {
						lead.preferredCommunication = comm;
					}
				}

				// String fields
				if (record.timezone && record.timezone.trim() !== '') {
					lead.timezone = record.timezone.trim();
				}

				if (record.bestContactTime && record.bestContactTime.trim() !== '') {
					lead.bestContactTime = record.bestContactTime.trim();
				}

				if (record.competitorInfo && record.competitorInfo.trim() !== '') {
					lead.competitorInfo = record.competitorInfo.trim();
				}

				if (record.referralSource && record.referralSource.trim() !== '') {
					lead.referralSource = record.referralSource.trim();
				}

				if (record.campaignName && record.campaignName.trim() !== '') {
					lead.campaignName = record.campaignName.trim();
				}

				if (record.landingPage && record.landingPage.trim() !== '') {
					lead.landingPage = record.landingPage.trim();
				}

				if (record.utmSource && record.utmSource.trim() !== '') {
					lead.utmSource = record.utmSource.trim();
				}

				if (record.utmMedium && record.utmMedium.trim() !== '') {
					lead.utmMedium = record.utmMedium.trim();
				}

				if (record.utmCampaign && record.utmCampaign.trim() !== '') {
					lead.utmCampaign = record.utmCampaign.trim();
				}

				if (record.utmTerm && record.utmTerm.trim() !== '') {
					lead.utmTerm = record.utmTerm.trim();
				}

				if (record.utmContent && record.utmContent.trim() !== '') {
					lead.utmContent = record.utmContent.trim();
				}

				// Parse painPoints (comma-separated to JSON string array)
				if (record.painPoints) {
					const painPoints = parsePainPoints(record.painPoints);
					if (painPoints) {
						lead.painPoints = painPoints;
					}
				}

				// Parse customFields (JSON string)
				if (record.customFields) {
					const customFields = parseJSON(record.customFields);
					if (customFields) {
						lead.customFields = customFields;
					}
				}

				leads.push(lead);
			} catch (error: any) {
				errors.push({
					row: rowNumber,
					error: error.message || 'Failed to parse row',
				});
			}
		});
	} catch (error: any) {
		errors.push({
			row: 0,
			error: `CSV parsing failed: ${error.message}`,
		});
	}

	return { leads, errors };
}
