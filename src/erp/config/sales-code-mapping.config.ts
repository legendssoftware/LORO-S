/**
 * Sales Code to Sales Person Name Mapping Configuration
 * 
 * Maps sales_code values from tblsalesheader to actual salesperson names/descriptions.
 * This mapping is used to display human-readable names instead of codes in reports.
 */

export const SALES_CODE_MAPPING: Record<string, string> = {
	'HOU01': 'HOUSE ACCOUNT DENVER',
	'INO01': 'INNOCENT',
	'CEB01': 'CEBO',
	'FAI01': 'FAISON',
	'RUB01': 'RUBEN',
	'STI01': 'STIGA',
	'JULN': 'JULIAN',
	'SIY01': 'SIYA',
	'SID01': 'SIDNEY',
	'TEN01': 'TENDANI MAPHAHA',
	'MOK01': 'MOKOPANE',
	'YORK01': 'YORRICK',
	'PY': 'PENNY',
	'VUYO01': 'VUYO',
	'INT01': 'INTERBRANCH',
	'MEM01': 'MEMBER BUSINESS',
	'RENT': 'RENTALS',
	'MUS01': 'MUSA',
	'SNE01': 'SNETHEMBA',
	'HOU05': 'HOUSE ACCOUNT NELSPRUIT',
	'TZA01': 'Tzaneen',
	'MACK01': 'MACK',
	'BONG01': 'BONGISIPHO',
	'RIAAN': 'RIAAN',
	'THAB01': 'THABO',
	'DYL01': 'DYLAN',
	'JOHAO1': 'JOHANNES',
	'ANDR01': 'ANDREW',
	'HOUS08': 'HOUSE ACCOUNT BETHLEHEM',
	'DAKA01': 'DAKALO',
	'PIE01': 'PIETER',
	'THOR01': 'THORISO',
	'BRAN01': 'BRANDON',
	'ROB01': 'ROBERTO',
	'NULL': 'NULL',
	// Handle variations/typos that might exist in the data
	'YOR01': 'YORRICK', // Variation seen in sample data
	'HOU02': 'HOUSE ACCOUNT', // Variation seen in sample data
	'JOHA01': 'JOHANNES', // Variation seen in sample data
};

/**
 * Helper function to get sales person name from sales code
 * 
 * @param salesCode - The sales_code from tblsalesheader
 * @returns The sales person name/description, or the code itself if not found
 */
export function getSalesPersonName(salesCode: string | null | undefined): string {
	if (!salesCode || salesCode.trim() === '') {
		return 'Unknown Sales Person';
	}
	
	// Normalize the code (trim and uppercase for consistency)
	const normalizedCode = salesCode.trim().toUpperCase();
	
	// Return mapped name or the code itself as fallback
	return SALES_CODE_MAPPING[normalizedCode] || salesCode;
}

/**
 * Helper function to check if a sales code exists in the mapping
 */
export function hasSalesCodeMapping(salesCode: string | null | undefined): boolean {
	if (!salesCode || salesCode.trim() === '') {
		return false;
	}
	
	const normalizedCode = salesCode.trim().toUpperCase();
	return SALES_CODE_MAPPING.hasOwnProperty(normalizedCode);
}

