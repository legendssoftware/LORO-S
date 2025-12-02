/**
 * Currency Utility
 * Maps country codes to ISO 4217 currency codes and symbols
 * Based on ISO 4217 standard: https://www.iso.org/iso-4217-currency-codes.html
 */

export interface CurrencyInfo {
	code: string; // ISO 4217 currency code (e.g., 'ZAR', 'BWP')
	symbol: string; // Currency symbol (e.g., 'R', 'P')
	locale: string; // Locale for formatting (e.g., 'en-ZA', 'en-BW')
	name: string; // Currency name (e.g., 'South African Rand', 'Botswana Pula')
}

/**
 * Country code to currency mapping
 * Maps internal country codes to ISO 4217 currency information
 */
const COUNTRY_CURRENCY_MAP: Record<string, CurrencyInfo> = {
	// South Africa
	'SA': {
		code: 'ZAR',
		symbol: 'R',
		locale: 'en-ZA',
		name: 'South African Rand',
	},
	// Botswana
	'BOT': {
		code: 'BWP',
		symbol: 'P',
		locale: 'en-BW',
		name: 'Botswana Pula',
	},
	// Zambia
	'ZAM': {
		code: 'ZMW',
		symbol: 'ZK',
		locale: 'en-ZM',
		name: 'Zambian Kwacha',
	},
	// Mozambique
	'MOZ': {
		code: 'MZN',
		symbol: 'MT',
		locale: 'pt-MZ',
		name: 'Mozambican Metical',
	},
	// Zimbabwe
	'ZW': {
		code: 'ZWL',
		symbol: 'ZiG',
		locale: 'en-ZW',
		name: 'Zimbabwean Gold',
	},
};

/**
 * Get currency information for a country code
 * @param countryCode Country code (SA, BOT, ZAM, MOZ, ZW)
 * @returns Currency information (code, symbol, locale, name)
 */
export function getCurrencyForCountry(countryCode: string = 'SA'): CurrencyInfo {
	const normalizedCode = countryCode?.toUpperCase() || 'SA';
	return COUNTRY_CURRENCY_MAP[normalizedCode] || COUNTRY_CURRENCY_MAP['SA'];
}

/**
 * Format amount with country-specific currency
 * @param amount Amount to format
 * @param countryCode Country code
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, countryCode: string = 'SA'): string {
	const currency = getCurrencyForCountry(countryCode);
	return new Intl.NumberFormat(currency.locale, {
		style: 'currency',
		currency: currency.code,
	}).format(amount);
}

