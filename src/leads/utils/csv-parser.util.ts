import { parse } from 'csv-parse/sync';
import { LeadSource, Industry, BudgetRange } from '../../lib/enums/lead.enums';

export interface ParsedLeadRow {
	name?: string;
	email?: string;
	phone?: string;
	companyName: string;
	notes?: string;
	estimatedValue?: number;
	source?: LeadSource;
	industry?: Industry;
	budgetRange?: BudgetRange;
	jobTitle?: string;
}

export interface CSVParseResult {
	leads: ParsedLeadRow[];
	errors: Array<{ row: number; error: string }>;
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

				// Optional fields
				if (record.notes && record.notes.trim() !== '') {
					lead.notes = record.notes.trim();
				}

				if (record.estimatedValue) {
					const value = parseFloat(record.estimatedValue);
					if (!isNaN(value)) {
						lead.estimatedValue = value;
					}
				}

				if (record.source && record.source.trim() !== '') {
					// Validate source enum
					const validSource = Object.values(LeadSource).find(
						(s) => s === record.source.toUpperCase().replace(/\s+/g, '_'),
					);
					if (validSource) {
						lead.source = validSource;
					}
				}

				if (record.industry && record.industry.trim() !== '') {
					const validIndustry = Object.values(Industry).find(
						(i) => i === record.industry.toUpperCase().replace(/\s+/g, '_'),
					);
					if (validIndustry) {
						lead.industry = validIndustry;
					}
				}

				if (record.budgetRange && record.budgetRange.trim() !== '') {
					const validBudget = Object.values(BudgetRange).find(
						(b) => b === record.budgetRange.toUpperCase().replace(/\s+/g, '_'),
					);
					if (validBudget) {
						lead.budgetRange = validBudget;
					}
				}

				if (record.jobTitle && record.jobTitle.trim() !== '') {
					lead.jobTitle = record.jobTitle.trim();
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
