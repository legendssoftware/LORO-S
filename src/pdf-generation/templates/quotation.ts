// Use CommonJS require for PDFKit
const PDFDocument = require('pdfkit');
import { QuotationTemplateData } from '../interfaces/pdf-templates.interface';
import * as fs from 'fs'; // For reading logo file

// --- Styling Constants ---
const PAGE_MARGIN = 25; // Reduced from 50
const BOX_PADDING = 5; // Consistent 5px padding as requested
const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_SIZE_XLARGE_TITLE = 20;
const FONT_SIZE_LARGE_TITLE = 16;
const FONT_SIZE_MEDIUM_TITLE = 14;
const FONT_SIZE_NORMAL = 10;
const FONT_SIZE_SMALL = 8;
const COLOR_TEXT_HEADER = '#333333';
const COLOR_TEXT_NORMAL = '#555555';
const COLOR_TEXT_LIGHT = '#777777';
const COLOR_LINE = '#CCCCCC';
const COLOR_TABLE_HEADER_BG = '#EEEEEE';

// --- Helper Functions ---

/**
 * Format a date to a standard format
 */
function formatDate(date: Date | string): string {
	const d = new Date(date);
	return d.toLocaleDateString('en-ZA', {
		// Using en-ZA for DD/MM/YYYY, adjust as needed
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

/**
 * Format a currency value
 */
function formatCurrency(amount: number, currency: string): string {
	return new Intl.NumberFormat('en-ZA', {
		// Using en-ZA, adjust as needed
		style: 'currency',
		currency: currency || 'ZAR', // Default to ZAR if not provided
	}).format(amount);
}

/**
 * Draws a titled box with content
 * @param doc PDFKit document
 * @param x X position
 * @param y Y position
 * @param width Width of the box
 * @param height Height of the box (if 0, height will be calculated from content)
 * @param title Title for the box (optional)
 * @param contentCallback Callback to draw content inside the box
 * @returns The y position after drawing the box and content
 */
function drawBoxWithTitle(
	doc: any,
	x: number,
	y: number,
	width: number,
	height: number, // if 0, height will be calculated based on content
	title: string | null,
	contentCallback: (currentX: number, currentY: number) => number, // returns new Y
): number {
	const initialY = y;
	const internalContentX = x + BOX_PADDING; // Consistent internal padding
	let internalContentY = y + BOX_PADDING; // Consistent internal padding

	if (title) {
		doc.fontSize(FONT_SIZE_MEDIUM_TITLE).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
		doc.text(title, internalContentX, internalContentY);
		internalContentY += FONT_SIZE_MEDIUM_TITLE + BOX_PADDING;
	}

	const contentEndY = contentCallback(internalContentX, internalContentY);

	// Calculate final height based on content or use provided fixed height
	const actualHeight = height > 0 ? height : contentEndY - initialY + BOX_PADDING;

	// Draw the box border
	doc.rect(x, initialY, width, actualHeight).strokeColor(COLOR_LINE).stroke();
	return initialY + actualHeight;
}

/**
 * Add items table to the PDF
 */
/**
 * Truncate text with ellipsis if it exceeds max length
 */
function truncateText(text: string, maxLength: number): string {
	if (!text || text.length <= maxLength) return text || '';
	return text.substring(0, maxLength - 3) + '...';
}

/**
 * Calculate optimal column widths based on content
 */
function calculateColumnWidths(
	doc: any,
	items: any[],
	tableWidth: number,
): { itemCode: number; description: number; quantity: number; unitPrice: number; total: number } {
	// Minimum widths
	const minItemCode = 60;
	const minQuantity = 70;
	const minUnitPrice = 80;
	const minTotal = 80;
	const minDescription = 150;

	// Calculate max content widths
	let maxItemCodeWidth = minItemCode;
	let maxDescriptionWidth = minDescription;
	let maxQuantityWidth = minQuantity;
	let maxUnitPriceWidth = minUnitPrice;
	let maxTotalWidth = minTotal;

	items.forEach((item) => {
		const itemCodeText = item.itemCode || '-';
		const descriptionText = item.description || '';
		const quantityText = item.quantity?.toString() || '0';
		const unitPriceText = formatCurrency(item.unitPrice || 0, 'ZAR');
		const totalText = formatCurrency((item.quantity || 0) * (item.unitPrice || 0), 'ZAR');

		maxItemCodeWidth = Math.max(maxItemCodeWidth, doc.widthOfString(itemCodeText) + 10);
		maxDescriptionWidth = Math.max(maxDescriptionWidth, doc.widthOfString(descriptionText.substring(0, 50)) + 10);
		maxQuantityWidth = Math.max(maxQuantityWidth, doc.widthOfString(quantityText) + 10);
		maxUnitPriceWidth = Math.max(maxUnitPriceWidth, doc.widthOfString(unitPriceText) + 10);
		maxTotalWidth = Math.max(maxTotalWidth, doc.widthOfString(totalText) + 10);
	});

	// Calculate fixed columns total
	const fixedColumnsWidth = maxItemCodeWidth + maxQuantityWidth + maxUnitPriceWidth + maxTotalWidth + 20; // 20 for padding
	const availableWidth = tableWidth - fixedColumnsWidth;

	// Description gets remaining space, but with min/max constraints
	const descriptionWidth = Math.max(minDescription, Math.min(availableWidth, maxDescriptionWidth));

	// Adjust if description is too wide
	const totalFixed = maxItemCodeWidth + descriptionWidth + maxQuantityWidth + maxUnitPriceWidth + maxTotalWidth + 20;
	if (totalFixed > tableWidth) {
		// Reduce description width proportionally
		const scaleFactor = (tableWidth - 20) / totalFixed;
		return {
			itemCode: Math.floor(maxItemCodeWidth * scaleFactor),
			description: Math.floor(descriptionWidth * scaleFactor),
			quantity: Math.floor(maxQuantityWidth * scaleFactor),
			unitPrice: Math.floor(maxUnitPriceWidth * scaleFactor),
			total: Math.floor(maxTotalWidth * scaleFactor),
		};
	}

	return {
		itemCode: maxItemCodeWidth,
		description: descriptionWidth,
		quantity: maxQuantityWidth,
		unitPrice: maxUnitPriceWidth,
		total: maxTotalWidth,
	};
}

function addItemsTable(doc: any, data: QuotationTemplateData, startY: number): number {
	let currentY = startY;
	const tableStartX = PAGE_MARGIN;
	const tableWidth = doc.page.width - 2 * PAGE_MARGIN;

	// Calculate optimal column widths based on content
	const colWidths = calculateColumnWidths(doc, data.items || [], tableWidth);

	// Table headers
	doc.fillColor(COLOR_TEXT_HEADER).fontSize(FONT_SIZE_NORMAL).font(FONT_BOLD);
	let currentX = tableStartX;

	// Background for header
	doc.rect(tableStartX, currentY, tableWidth, FONT_SIZE_NORMAL + BOX_PADDING).fill(COLOR_TABLE_HEADER_BG);
	doc.fillColor(COLOR_TEXT_HEADER); // Reset fill color for text

	doc.text('Item Code', currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2);
	currentX += colWidths.itemCode;
	doc.text('Product Name', currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2);
	currentX += colWidths.description;
	doc.text('Quantity', currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2, {
		width: colWidths.quantity - BOX_PADDING,
		align: 'right',
	});
	currentX += colWidths.quantity;
	doc.text('Unit Price', currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2, {
		width: colWidths.unitPrice - BOX_PADDING,
		align: 'right',
	});
	currentX += colWidths.unitPrice;
	doc.text('Total', currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2, {
		width: colWidths.total - BOX_PADDING,
		align: 'right',
	});

	currentY += FONT_SIZE_NORMAL + BOX_PADDING + BOX_PADDING / 2;

	// Table rows
	doc.font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);

	const drawTableHeader = (y: number) => {
		doc.fillColor(COLOR_TEXT_HEADER).fontSize(FONT_SIZE_NORMAL).font(FONT_BOLD);
		let headerX = tableStartX;
		doc.rect(tableStartX, y, tableWidth, FONT_SIZE_NORMAL + BOX_PADDING).fill(COLOR_TABLE_HEADER_BG);
		doc.fillColor(COLOR_TEXT_HEADER);
		doc.text('Item Code', headerX + BOX_PADDING / 2, y + BOX_PADDING / 2);
		headerX += colWidths.itemCode;
		doc.text('Product Name', headerX + BOX_PADDING / 2, y + BOX_PADDING / 2);
		headerX += colWidths.description;
		doc.text('Quantity', headerX + BOX_PADDING / 2, y + BOX_PADDING / 2, {
			width: colWidths.quantity - BOX_PADDING,
			align: 'right',
		});
		headerX += colWidths.quantity;
		doc.text('Unit Price', headerX + BOX_PADDING / 2, y + BOX_PADDING / 2, {
			width: colWidths.unitPrice - BOX_PADDING,
			align: 'right',
		});
		headerX += colWidths.unitPrice;
		doc.text('Total', headerX + BOX_PADDING / 2, y + BOX_PADDING / 2, {
			width: colWidths.total - BOX_PADDING,
			align: 'right',
		});
		doc.font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
		return y + FONT_SIZE_NORMAL + BOX_PADDING + BOX_PADDING / 2;
	};

	data.items.forEach((item) => {
		// Prepare text with smart truncation and wrapping
		const itemCodeText = truncateText(item.itemCode || '-', 15);
		const descriptionText = item.description || '';
		const quantityText = item.quantity?.toString() || '0';
		const unitPriceText = formatCurrency(item.unitPrice || 0, data.currency || 'ZAR');
		const totalText = formatCurrency((item.quantity || 0) * (item.unitPrice || 0), data.currency || 'ZAR');

		// Calculate height for multi-line description
		const descriptionWidth = colWidths.description - BOX_PADDING;
		const descriptionHeight = doc.heightOfString(descriptionText, {
			width: descriptionWidth,
			ellipsis: true, // Enable ellipsis for overflow
		});

		// Calculate row height (ensure minimum height for readability)
		const itemRowHeight = Math.max(
			FONT_SIZE_NORMAL + BOX_PADDING * 2,
			descriptionHeight + BOX_PADDING,
		);

		// Check for page break
		if (currentY + itemRowHeight > doc.page.height - PAGE_MARGIN - 50) {
			doc.addPage();
			currentY = PAGE_MARGIN;
			currentY = drawTableHeader(currentY);
		}

		// Draw row content
		currentX = tableStartX;

		// Item Code
		doc.text(itemCodeText, currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2, {
			width: colWidths.itemCode - BOX_PADDING,
			ellipsis: true,
		});
		currentX += colWidths.itemCode;

		// Description with multi-line support and wrapping
		const descriptionY = currentY + BOX_PADDING / 2;
		doc.text(descriptionText, currentX + BOX_PADDING / 2, descriptionY, {
			width: descriptionWidth,
			ellipsis: true, // Add ellipsis if text is too long
			lineGap: 2, // Small gap between lines
		});
		currentX += colWidths.description;

		// Quantity (right-aligned)
		doc.text(quantityText, currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2, {
			width: colWidths.quantity - BOX_PADDING,
			align: 'right',
		});
		currentX += colWidths.quantity;

		// Unit Price (right-aligned)
		doc.text(unitPriceText, currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2, {
			width: colWidths.unitPrice - BOX_PADDING,
			align: 'right',
		});
		currentX += colWidths.unitPrice;

		// Total (right-aligned)
		doc.text(totalText, currentX + BOX_PADDING / 2, currentY + BOX_PADDING / 2, {
			width: colWidths.total - BOX_PADDING,
			align: 'right',
		});

		// Move to next row
		currentY += itemRowHeight;

		// Draw horizontal line separator
		doc.moveTo(tableStartX, currentY)
			.lineTo(tableStartX + tableWidth, currentY)
			.strokeColor(COLOR_LINE)
			.stroke();
	});

	return currentY + BOX_PADDING;
}

/**
 * Generate a quotation PDF using PDFKit
 * @param doc PDFKit document instance
 * @param data Quotation data to populate the template
 */
export const generateQuotationPDF = (doc: any, data: QuotationTemplateData): void => {
	// Set document properties
	doc.info.Title = `Quotation #${data.quotationId}`;
	doc.info.Author = data.companyDetails.name || 'Loro';
	doc.info.Creator = data.companyDetails.name || 'Loro';

	// Calculate available width for content (full page width - 2 * margin)
	const availableWidth = doc.page.width - 2 * PAGE_MARGIN;
	// For two columns, divide available width by 2 and subtract inter-box padding
	const interBoxPadding = BOX_PADDING * 2; // Space between the two main columns of boxes
	const columnWidth = (availableWidth - interBoxPadding) / 2;

	let currentY = PAGE_MARGIN;

	// --- Header: Title and Logo ---
	doc.fontSize(FONT_SIZE_XLARGE_TITLE).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
	doc.text('QUOTATION', PAGE_MARGIN, currentY);

	if (data.companyDetails.logoPath) {
		try {
			// Check if file exists before trying to use it
			if (fs.existsSync(data.companyDetails.logoPath)) {
				const logoWidth = 100; // Adjust as needed
				doc.image(data.companyDetails.logoPath, doc.page.width - PAGE_MARGIN - logoWidth, currentY, {
					fit: [logoWidth, 50], // Adjust height fit as needed
					align: 'right',
				});
			} else {
				console.warn(`Logo file not found: ${data.companyDetails.logoPath}`);
			}
		} catch (err) {
			console.error('Error embedding logo:', err);
		}
	}
	currentY += Math.max(FONT_SIZE_XLARGE_TITLE, 50) + BOX_PADDING; // Reduced from BOX_PADDING * 2

	// --- Top Row: Company Details and Document Details ---
	const companyDetailsBoxX = PAGE_MARGIN;
	const documentDetailsBoxX = PAGE_MARGIN + columnWidth + interBoxPadding;

	// Measure height for company details box to determine fixed height for the row
	// We'll calculate the needed heights first, then use the maximum for both boxes
	let companyDetailsHeight = 0;
	let documentDetailsHeight = 0;

	// First pass to calculate heights
	const companyDetailsContentHeightCb = (cx, cy) => {
		let localY = cy;
		doc.fontSize(FONT_SIZE_NORMAL).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
		doc.text(data.companyDetails.name, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
		localY += FONT_SIZE_NORMAL + 2;
		doc.font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
		if (data.companyDetails.addressLines) {
			data.companyDetails.addressLines.forEach((line) => {
				doc.text(line, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
				localY += FONT_SIZE_NORMAL + 2;
			});
		}
		if (data.companyDetails.phone) {
			doc.text(`Tel: ${data.companyDetails.phone}`, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		if (data.companyDetails.email) {
			doc.text(`Email: ${data.companyDetails.email}`, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		if (data.companyDetails.website) {
			doc.text(`Web: ${data.companyDetails.website}`, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		if (data.companyDetails.vatNumber) {
			doc.text(`VAT Reg: ${data.companyDetails.vatNumber}`, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		return localY;
	};

	const documentDetailsContentHeightCb = (cx, cy) => {
		let localY = cy;
		doc.fillColor(COLOR_TEXT_NORMAL).fontSize(FONT_SIZE_NORMAL);

		doc.font(FONT_BOLD).text('Quotation #:', cx, localY, { continued: true });
		doc.font(FONT_REGULAR).text(` ${data.quotationId}`, { continued: false });
		localY += FONT_SIZE_NORMAL + 2;

		doc.font(FONT_BOLD).text('Date:', cx, localY, { continued: true });
		doc.font(FONT_REGULAR).text(` ${formatDate(data.date)}`, { continued: false });
		localY += FONT_SIZE_NORMAL + 2;

		doc.font(FONT_BOLD).text('Valid Until:', cx, localY, { continued: true });
		doc.font(FONT_REGULAR).text(` ${formatDate(data.validUntil)}`, { continued: false });
		localY += FONT_SIZE_NORMAL + 2;

		// Add Sales Rep or Page Number here if needed from data
		return localY;
	};

	// Calculate heights without drawing
	const companyContentEndY = companyDetailsContentHeightCb(
		companyDetailsBoxX + BOX_PADDING,
		currentY + BOX_PADDING + FONT_SIZE_MEDIUM_TITLE + BOX_PADDING,
	);
	companyDetailsHeight = companyContentEndY - currentY + BOX_PADDING;

	const documentContentEndY = documentDetailsContentHeightCb(
		documentDetailsBoxX + BOX_PADDING,
		currentY + BOX_PADDING + FONT_SIZE_MEDIUM_TITLE + BOX_PADDING,
	);
	documentDetailsHeight = documentContentEndY - currentY + BOX_PADDING;

	// Use maximum height for both boxes to ensure they're the same size
	const topRowHeight = Math.max(companyDetailsHeight, documentDetailsHeight);

	// Now draw the boxes with fixed height
	drawBoxWithTitle(doc, companyDetailsBoxX, currentY, columnWidth, topRowHeight, 'Company Details', (cx, cy) => {
		return companyDetailsContentHeightCb(cx, cy);
	});

	drawBoxWithTitle(doc, documentDetailsBoxX, currentY, columnWidth, topRowHeight, 'Document Details', (cx, cy) => {
		return documentDetailsContentHeightCb(cx, cy);
	});

	currentY += topRowHeight + BOX_PADDING * 2; // Increased spacing between box rows

	// --- Middle Row: Customer Info and Deliver To ---
	const customerInfoBoxX = PAGE_MARGIN;
	const deliverToBoxX = PAGE_MARGIN + columnWidth + interBoxPadding;

	// Similar approach for customer info and deliver to boxes
	let customerInfoHeight = 0;
	let deliverToHeight = 0;

	// First pass to calculate heights
	const customerInfoContentHeightCb = (cx, cy) => {
		let localY = cy;
		doc.fontSize(FONT_SIZE_NORMAL).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
		doc.text(data.client.name, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
		localY += FONT_SIZE_NORMAL + 2;
		doc.font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
		if (data.client.address) {
			const addressText = data.client.address;
			const addressHeight = doc.heightOfString(addressText, { width: columnWidth - BOX_PADDING * 2 });
			doc.text(addressText, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += addressHeight + 2;
		}
		if (data.client.phone) {
			doc.text(`Tel: ${data.client.phone}`, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		if (data.client.email) {
			doc.text(`Email: ${data.client.email}`, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		return localY;
	};

	const deliverToContentHeightCb = (cx, cy) => {
		let localY = cy;
		doc.fontSize(FONT_SIZE_NORMAL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
		if (data.client.deliveryAddress) {
			const deliveryText = data.client.deliveryAddress;
			const deliveryHeight = doc.heightOfString(deliveryText, { width: columnWidth - BOX_PADDING * 2 });
			doc.text(deliveryText, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += deliveryHeight + 2;
		} else if (data.client.address) {
			const addressText = data.client.address || 'Same as Customer Address';
			const addressHeight = doc.heightOfString(addressText, { width: columnWidth - BOX_PADDING * 2 });
			doc.text(addressText, cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += addressHeight + 2;
		} else {
			doc.text('Same as Customer Address', cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		return localY;
	};

	// Calculate heights without drawing
	const customerContentEndY = customerInfoContentHeightCb(
		customerInfoBoxX + BOX_PADDING,
		currentY + BOX_PADDING + FONT_SIZE_MEDIUM_TITLE + BOX_PADDING,
	);
	customerInfoHeight = customerContentEndY - currentY + BOX_PADDING;

	const deliverContentEndY = deliverToContentHeightCb(
		deliverToBoxX + BOX_PADDING,
		currentY + BOX_PADDING + FONT_SIZE_MEDIUM_TITLE + BOX_PADDING,
	);
	deliverToHeight = deliverContentEndY - currentY + BOX_PADDING;

	// Use maximum height for both boxes to ensure they're the same size
	const middleRowHeight = Math.max(customerInfoHeight, deliverToHeight);

	// Now draw the boxes with fixed height
	drawBoxWithTitle(
		doc,
		customerInfoBoxX,
		currentY,
		columnWidth,
		middleRowHeight,
		'Customer Information',
		(cx, cy) => {
			return customerInfoContentHeightCb(cx, cy);
		},
	);

	drawBoxWithTitle(doc, deliverToBoxX, currentY, columnWidth, middleRowHeight, 'Deliver To', (cx, cy) => {
		return deliverToContentHeightCb(cx, cy);
	});

	currentY += middleRowHeight + BOX_PADDING * 2; // Increased spacing between box rows

	// --- Items Table ---
	currentY = addItemsTable(doc, data, currentY) + BOX_PADDING * 2;

	// --- Bottom Section: Banking Details and Totals ---
	const bankingDetailsBoxX = PAGE_MARGIN;
	// Totals box should align with the right column
	const totalsBoxX = PAGE_MARGIN + columnWidth + interBoxPadding;

	// Similar approach for banking details and totals boxes
	let bankingDetailsHeight = 0;
	let totalsHeight = 0;

	// First pass to calculate heights
	const bankingDetailsContentHeightCb = (cx, cy) => {
		let localY = cy;
		doc.fontSize(FONT_SIZE_NORMAL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
		if (data.bankingDetails) {
			doc.font(FONT_BOLD).text('Bank:', cx, localY, { continued: true, width: columnWidth - BOX_PADDING * 2 });
			doc.font(FONT_REGULAR).text(` ${data.bankingDetails.bankName || ''}`, {
				continued: false,
				width: columnWidth - BOX_PADDING * 2,
			});
			localY += FONT_SIZE_NORMAL + 2;

			doc.font(FONT_BOLD).text('Account Holder:', cx, localY, {
				continued: true,
				width: columnWidth - BOX_PADDING * 2,
			});
			doc.font(FONT_REGULAR).text(` ${data.bankingDetails.accountHolder || data.companyDetails.name}`, {
				continued: false,
				width: columnWidth - BOX_PADDING * 2,
			});
			localY += FONT_SIZE_NORMAL + 2;

			doc.font(FONT_BOLD).text('Account Number:', cx, localY, {
				continued: true,
				width: columnWidth - BOX_PADDING * 2,
			});
			doc.font(FONT_REGULAR).text(` ${data.bankingDetails.accountNumber || ''}`, {
				continued: false,
				width: columnWidth - BOX_PADDING * 2,
			});
			localY += FONT_SIZE_NORMAL + 2;

			if (data.bankingDetails.branchCode) {
				doc.font(FONT_BOLD).text('Branch Code:', cx, localY, {
					continued: true,
					width: columnWidth - BOX_PADDING * 2,
				});
				doc.font(FONT_REGULAR).text(` ${data.bankingDetails.branchCode}`, {
					continued: false,
					width: columnWidth - BOX_PADDING * 2,
				});
				localY += FONT_SIZE_NORMAL + 2;
			}

			if (data.bankingDetails.swiftCode) {
				doc.font(FONT_BOLD).text('SWIFT Code:', cx, localY, {
					continued: true,
					width: columnWidth - BOX_PADDING * 2,
				});
				doc.font(FONT_REGULAR).text(` ${data.bankingDetails.swiftCode}`, {
					continued: false,
					width: columnWidth - BOX_PADDING * 2,
				});
				localY += FONT_SIZE_NORMAL + 2;
			}

			doc.font(FONT_BOLD).text('Reference:', cx, localY, {
				continued: true,
				width: columnWidth - BOX_PADDING * 2,
			});
			doc.font(FONT_REGULAR).text(` ${data.bankingDetails.paymentReferencePrefix || 'Q'}${data.quotationId}`, {
				continued: false,
				width: columnWidth - BOX_PADDING * 2,
			});
			localY += FONT_SIZE_NORMAL + 2;
		} else {
			doc.text('Banking details not provided.', cx, localY, { width: columnWidth - BOX_PADDING * 2 });
			localY += FONT_SIZE_NORMAL + 2;
		}
		return localY;
	};

	const totalsContentHeightCb = (cx, cy) => {
		let localY = cy;
		const fieldIndent = cx + BOX_PADDING;
		const valueIndent = cx + columnWidth - BOX_PADDING * 2 - 100;

		doc.fontSize(FONT_SIZE_NORMAL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
		doc.text('Subtotal:', fieldIndent, localY, { width: columnWidth - BOX_PADDING * 4 - 100 });
		doc.text(formatCurrency(data.subtotal, data.currency), valueIndent, localY, { width: 100, align: 'right' });
		localY += FONT_SIZE_NORMAL + 4;

		doc.text('Tax:', fieldIndent, localY, { width: columnWidth - BOX_PADDING * 4 - 100 });
		doc.text(formatCurrency(data.tax, data.currency), valueIndent, localY, { width: 100, align: 'right' });
		localY += FONT_SIZE_NORMAL + 4;

		doc.font(FONT_BOLD).fontSize(FONT_SIZE_MEDIUM_TITLE).fillColor(COLOR_TEXT_HEADER);
		doc.text('Total:', fieldIndent, localY, { width: columnWidth - BOX_PADDING * 4 - 100 });
		doc.text(formatCurrency(data.total, data.currency), valueIndent, localY, { width: 100, align: 'right' });
		localY += FONT_SIZE_MEDIUM_TITLE + 4;
		return localY;
	};

	// Calculate heights without drawing
	const bankingContentEndY = bankingDetailsContentHeightCb(
		bankingDetailsBoxX + BOX_PADDING,
		currentY + BOX_PADDING + FONT_SIZE_MEDIUM_TITLE + BOX_PADDING,
	);
	bankingDetailsHeight = bankingContentEndY - currentY + BOX_PADDING;

	const totalsContentEndY = totalsContentHeightCb(totalsBoxX + BOX_PADDING, currentY + BOX_PADDING);
	totalsHeight = totalsContentEndY - currentY + BOX_PADDING;

	// Use maximum height for both boxes to ensure they're the same size
	const bottomRowHeight = Math.max(bankingDetailsHeight, totalsHeight);

	// Now draw the boxes with fixed height
	drawBoxWithTitle(doc, bankingDetailsBoxX, currentY, columnWidth, bottomRowHeight, 'Banking Details', (cx, cy) => {
		return bankingDetailsContentHeightCb(cx, cy);
	});

	drawBoxWithTitle(doc, totalsBoxX, currentY, columnWidth, bottomRowHeight, null, (cx, cy) => {
		return totalsContentHeightCb(cx, cy);
	});

	currentY += bottomRowHeight + BOX_PADDING;

	// --- Terms and Conditions ---
	if (data.terms) {
		doc.fontSize(FONT_SIZE_MEDIUM_TITLE).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
		doc.text('Terms and Conditions', PAGE_MARGIN, currentY, { underline: true });
		currentY += FONT_SIZE_MEDIUM_TITLE + BOX_PADDING / 2;
		doc.fontSize(FONT_SIZE_SMALL).font(FONT_REGULAR).fillColor(COLOR_TEXT_LIGHT);
		doc.text(data.terms, PAGE_MARGIN, currentY, { width: doc.page.width - 2 * PAGE_MARGIN });
	}

	// --- Footer with page number (applied to all pages) ---
	const range = doc.bufferedPageRange(); // Note: cant get actual page count until end, but good for template
	for (let i = range.start; i < range.start + range.count; i++) {
		doc.switchToPage(i);
		doc.fontSize(FONT_SIZE_SMALL).font(FONT_REGULAR).fillColor(COLOR_TEXT_LIGHT);
		doc.text(
			`Page ${i + 1 - range.start} of ${range.count}`,
			PAGE_MARGIN,
			doc.page.height - PAGE_MARGIN + BOX_PADDING, // Position slightly lower
			{ align: 'center', width: doc.page.width - 2 * PAGE_MARGIN },
		);
	}
};
