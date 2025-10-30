/**
 * Document Type Enumeration
 * 
 * Defines the types of sales documents in the ERP system.
 * 
 * Note: tblsalesheader.doc_type is INT, tblsaleslines.doc_type is VARCHAR
 * This enum provides both number and string representations.
 */

/**
 * Document Type (for tblsalesheader - INT type)
 */
export enum DocType {
	/**
	 * Tax Invoice - Normal sales invoice (completed sale)
	 */
	TAX_INVOICE = 1,

	/**
	 * Credit Note - Returns/refunds (negative transaction)
	 */
	CREDIT_NOTE = 2,

	/**
	 * Quotation - Price quote (not confirmed, potential sale)
	 * Can be converted to Tax Invoice (tracked via invoice_used field)
	 */
	QUOTATION = 3,

	/**
	 * Sales Order - Confirmed order (not yet invoiced)
	 */
	SALES_ORDER = 4,
}

/**
 * Document Type String (for tblsaleslines - VARCHAR type)
 * 
 * Note: Due to schema inconsistency, sales lines store doc_type as string
 */
export enum DocTypeString {
	/**
	 * Tax Invoice - Normal sales invoice (completed sale)
	 */
	TAX_INVOICE = '1',

	/**
	 * Credit Note - Returns/refunds (negative transaction)
	 */
	CREDIT_NOTE = '2',

	/**
	 * Quotation - Price quote (not confirmed, potential sale)
	 */
	QUOTATION = '3',

	/**
	 * Sales Order - Confirmed order (not yet invoiced)
	 */
	SALES_ORDER = '4',
}

/**
 * Document Type Labels (for display purposes)
 */
export const DocTypeLabel: Record<number, string> = {
	1: 'Tax Invoice',
	2: 'Credit Note',
	3: 'Quotation',
	4: 'Sales Order',
};

/**
 * Document Type Descriptions
 */
export const DocTypeDescription: Record<number, string> = {
	1: 'Completed sales transaction with tax calculation',
	2: 'Return or refund of previously invoiced items',
	3: 'Price quote for potential customer - can be converted to invoice',
	4: 'Confirmed customer order awaiting fulfillment and invoicing',
};

/**
 * Helper function to convert number to string doc type
 */
export function docTypeToString(docType: DocType): DocTypeString {
	return String(docType) as DocTypeString;
}

/**
 * Helper function to convert string to number doc type
 */
export function docTypeToNumber(docType: DocTypeString): DocType {
	return parseInt(docType, 10) as DocType;
}

/**
 * Check if doc type represents actual revenue
 * (Tax Invoices count as positive revenue, Credit Notes as negative)
 */
export function isRevenueDocument(docType: DocType | DocTypeString): boolean {
	const numType = typeof docType === 'string' ? docTypeToNumber(docType) : docType;
	return numType === DocType.TAX_INVOICE || numType === DocType.CREDIT_NOTE;
}

/**
 * Check if doc type represents confirmed sale
 * (Only Tax Invoices are confirmed completed sales)
 */
export function isConfirmedSale(docType: DocType | DocTypeString): boolean {
	const numType = typeof docType === 'string' ? docTypeToNumber(docType) : docType;
	return numType === DocType.TAX_INVOICE;
}

/**
 * Check if doc type can be converted to invoice
 * (Quotations and Sales Orders can become invoices)
 */
export function isConvertibleToInvoice(docType: DocType | DocTypeString): boolean {
	const numType = typeof docType === 'string' ? docTypeToNumber(docType) : docType;
	return numType === DocType.QUOTATION || numType === DocType.SALES_ORDER;
}





