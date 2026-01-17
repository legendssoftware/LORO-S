/**
 * Currency utility functions for consistent rounding and formatting
 */

/**
 * Round a number to 2 decimal places
 * @param value - The number to round
 * @returns Rounded number with 2 decimal places
 */
export function roundToTwoDecimals(value: number): number {
	if (typeof value !== 'number' || isNaN(value)) {
		return 0;
	}
	return Math.round(value * 100) / 100;
}

/**
 * Round a currency amount to 2 decimal places
 * @param amount - The amount to round
 * @returns Rounded amount
 */
export function roundCurrency(amount: number | string | null | undefined): number {
	if (amount === null || amount === undefined) {
		return 0;
	}
	const numValue = typeof amount === 'string' ? parseFloat(amount) : amount;
	return roundToTwoDecimals(numValue);
}

/**
 * Format currency with proper rounding
 * @param amount - The amount to format
 * @param currencyCode - Currency code (default: 'ZAR')
 * @param locale - Locale string (default: 'en-ZA')
 * @returns Formatted currency string
 */
export function formatCurrency(
	amount: number | string | null | undefined,
	currencyCode: string = 'ZAR',
	locale: string = 'en-ZA'
): string {
	const roundedAmount = roundCurrency(amount);
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: currencyCode,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(roundedAmount);
}

/**
 * Calculate total with proper rounding
 * @param amounts - Array of amounts to sum
 * @returns Rounded total
 */
export function calculateTotal(amounts: (number | string | null | undefined)[]): number {
	const sum = amounts.reduce((acc: number, amount) => {
		const numValue = typeof amount === 'string' ? parseFloat(amount) : (amount || 0);
		return acc + (isNaN(numValue) ? 0 : numValue);
	}, 0);
	return roundCurrency(sum);
}
