// Use CommonJS require for PDFKit
const PDFDocument = require('pdfkit');

// Styling Constants
const PAGE_MARGIN = 20;
const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_HEADER = 10;
const FONT_SIZE_NORMAL = 8;
const FONT_SIZE_SMALL = 7;
const COLOR_TEXT_HEADER = '#333333';
const COLOR_TEXT_NORMAL = '#555555';
const COLOR_LINE = '#CCCCCC';
const COLOR_TABLE_HEADER_BG = '#EEEEEE';

export interface CheckInsReportTemplateData {
	organizationName: string;
	reportDate: string;
	checkIns: Array<{
		dateTime: string;
		checkIn: string;
		methodOfVisit: string;
		companyName: string;
		typeOfBusiness: string;
		personSeen: string;
		positionOfPersonSeen: string;
		contactDetails: string;
		notes: string;
		quoteNumber: string;
		valueExVat: string;
		followUp: string;
		meetingLink: string | null;
	}>;
	summary: {
		totalVisits: number;
		completedVisits: number;
		inProgressVisits: number;
		totalDuration: string;
		averageDuration: string;
		totalSalesValue: number;
		uniqueUsers: number;
		uniqueClients: number;
	};
	generatedAt: string;
}

function truncate(s: string, maxLen: number): string {
	if (!s) return '-';
	const t = String(s).trim();
	return t.length <= maxLen ? t : t.slice(0, maxLen - 2) + '..';
}

export function generateCheckInsReportPDF(doc: any, data: CheckInsReportTemplateData): void {
	// Set landscape orientation
	doc.options.size = [792, 612]; // Landscape A4: 11" x 8.5"

	let y = PAGE_MARGIN;

	// Header
	doc.fontSize(FONT_SIZE_TITLE).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
	doc.text('Daily Check-Ins Report', PAGE_MARGIN, y);
	y += 20;

	doc.fontSize(FONT_SIZE_NORMAL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
	doc.text(`Organization: ${data.organizationName}`, PAGE_MARGIN, y);
	y += 12;
	doc.text(`Report Date: ${data.reportDate}`, PAGE_MARGIN, y);
	y += 12;
	doc.text(`Generated: ${data.generatedAt}`, PAGE_MARGIN, y);
	y += 20;

	// Summary Section
	doc.fontSize(FONT_SIZE_HEADER).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
	doc.text('Summary Statistics', PAGE_MARGIN, y);
	y += 15;

	doc.fontSize(FONT_SIZE_NORMAL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
	const summaryY = y;
	const summaryWidth = (doc.page.width - PAGE_MARGIN * 2) / 4;
	let summaryX = PAGE_MARGIN;

	doc.text(`Total Visits: ${data.summary.totalVisits}`, summaryX, summaryY);
	summaryX += summaryWidth;
	doc.text(`Completed: ${data.summary.completedVisits}`, summaryX, summaryY);
	summaryX += summaryWidth;
	doc.text(`In Progress: ${data.summary.inProgressVisits}`, summaryX, summaryY);
	summaryX += summaryWidth;
	doc.text(`Total Duration: ${data.summary.totalDuration}`, summaryX, summaryY);
	y = summaryY + 12;

	summaryX = PAGE_MARGIN;
	doc.text(`Avg Duration: ${data.summary.averageDuration}`, summaryX, y);
	summaryX += summaryWidth;
	doc.text(`Sales Value: R ${data.summary.totalSalesValue.toLocaleString('en-ZA')}`, summaryX, y);
	summaryX += summaryWidth;
	doc.text(`Unique Users: ${data.summary.uniqueUsers}`, summaryX, y);
	summaryX += summaryWidth;
	doc.text(`Unique Clients: ${data.summary.uniqueClients}`, summaryX, y);
	y += 25;

	// Table Header – 12 unified columns
	const colWidths = [75, 90, 40, 55, 45, 45, 45, 95, 75, 45, 50, 92];
	const colHeaders = [
		'Date and time',
		'Check-In',
		'Method of visit',
		'Company Name',
		'Type of Business',
		'Person Seen',
		'Position of Person Seen',
		'Contact Details',
		'Notes',
		'Quote Number',
		'Value - ex-VAT',
		'Follow Up',
	];

	doc.fontSize(FONT_SIZE_SMALL).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
	let x = PAGE_MARGIN;
	colHeaders.forEach((header, i) => {
		doc.rect(x, y, colWidths[i], 15).fillAndStroke(COLOR_TABLE_HEADER_BG, COLOR_LINE);
		doc.text(header, x + 2, y + 4, { width: colWidths[i] - 4, align: 'left' });
		x += colWidths[i];
	});
	y += 15;

	const rowHeight = 14;

	// Table Rows
	doc.fontSize(FONT_SIZE_SMALL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
	data.checkIns.forEach((checkIn) => {
		if (y > doc.page.height - PAGE_MARGIN - 25) {
			doc.addPage({ size: [792, 612] });
			y = PAGE_MARGIN;
			x = PAGE_MARGIN;
			colHeaders.forEach((header, i) => {
				doc.rect(x, y, colWidths[i], 15).fillAndStroke(COLOR_TABLE_HEADER_BG, COLOR_LINE);
				doc.text(header, x + 2, y + 4, { width: colWidths[i] - 4, align: 'left' });
				x += colWidths[i];
			});
			y += 15;
		}

		x = PAGE_MARGIN;
		const cells = [
			truncate(checkIn.dateTime, 28),
			truncate(checkIn.checkIn, 35),
			truncate(checkIn.methodOfVisit, 18),
			truncate(checkIn.companyName, 22),
			truncate(checkIn.typeOfBusiness, 18),
			truncate(checkIn.personSeen, 18),
			truncate(checkIn.positionOfPersonSeen, 18),
			truncate(checkIn.contactDetails, 38),
			truncate(checkIn.notes, 30),
			truncate(checkIn.quoteNumber, 18),
			truncate(checkIn.valueExVat, 20),
			truncate(checkIn.followUp + (checkIn.meetingLink ? ' [Link]' : ''), 36),
		];

		for (let i = 0; i < 12; i++) {
			doc.rect(x, y, colWidths[i], rowHeight).strokeColor(COLOR_LINE).stroke();
			doc.fillColor(COLOR_TEXT_NORMAL);
			doc.text(cells[i] || '-', x + 2, y + 2, { width: colWidths[i] - 4, align: 'left' });
			if (i === 11 && checkIn.meetingLink) {
				try {
					doc.link(x, y, colWidths[i], rowHeight, checkIn.meetingLink);
				} catch {
					// ignore link errors
				}
			}
			x += colWidths[i];
		}

		y += rowHeight;
	});

	// Footer
	const footerY = doc.page.height - PAGE_MARGIN - 10;
	doc.fontSize(FONT_SIZE_SMALL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
	doc.text(`Report generated on ${data.generatedAt}`, PAGE_MARGIN, footerY, { align: 'left' });
	doc.text(`Page ${doc.page.number}`, doc.page.width - PAGE_MARGIN - 50, footerY, { align: 'right' });
}
