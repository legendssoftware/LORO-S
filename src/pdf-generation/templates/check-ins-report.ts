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
		date: string;
		user: string;
		branch: string;
		checkInTime: string;
		checkOutTime: string;
		duration: string;
		status: string;
		clientName: string;
		contactFullName: string;
		contactCellPhone: string;
		contactLandline: string;
		contactEmail: string;
		contactAddress: string;
		companyName: string;
		businessType: string;
		personSeenPosition: string;
		checkInLocation: string;
		checkOutLocation: string;
		salesValue: string;
		quotationNumber: string;
		quotationStatus: string;
		notes: string;
		resolution: string;
		followUp: string;
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

	// Table Header
	const tableTop = y;
	const colWidths = [50, 60, 50, 40, 40, 40, 50, 60, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
	const colHeaders = [
		'Date', 'User', 'Branch', 'Check In', 'Check Out', 'Duration', 'Status',
		'Client', 'Contact', 'Phone', 'Email', 'Address', 'Company', 'Business',
		'Position', 'Location In', 'Location Out', 'Sales', 'Quote #', 'Quote Status',
		'Notes', 'Resolution', 'Follow Up'
	];

	doc.fontSize(FONT_SIZE_SMALL).font(FONT_BOLD).fillColor(COLOR_TEXT_HEADER);
	let x = PAGE_MARGIN;
	colHeaders.forEach((header, i) => {
		doc.rect(x, y, colWidths[i], 15).fillAndStroke(COLOR_TABLE_HEADER_BG, COLOR_LINE);
		doc.text(header, x + 2, y + 4, { width: colWidths[i] - 4, align: 'left' });
		x += colWidths[i];
	});
	y += 15;

	// Table Rows
	doc.fontSize(FONT_SIZE_SMALL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
	data.checkIns.forEach((checkIn, index) => {
		// Check if we need a new page
		if (y > doc.page.height - PAGE_MARGIN - 20) {
			doc.addPage();
			y = PAGE_MARGIN;
			// Redraw header
			x = PAGE_MARGIN;
			colHeaders.forEach((header, i) => {
				doc.rect(x, y, colWidths[i], 15).fillAndStroke(COLOR_TABLE_HEADER_BG, COLOR_LINE);
				doc.text(header, x + 2, y + 4, { width: colWidths[i] - 4, align: 'left' });
				x += colWidths[i];
			});
			y += 15;
		}

		const rowHeight = 12;
		x = PAGE_MARGIN;
		
		const values = [
			checkIn.date, checkIn.user, checkIn.branch, checkIn.checkInTime, checkIn.checkOutTime,
			checkIn.duration, checkIn.status, checkIn.clientName, checkIn.contactFullName,
			checkIn.contactCellPhone || checkIn.contactLandline, checkIn.contactEmail,
			checkIn.contactAddress.substring(0, 30), checkIn.companyName, checkIn.businessType,
			checkIn.personSeenPosition, checkIn.checkInLocation.substring(0, 20),
			checkIn.checkOutLocation ? checkIn.checkOutLocation.substring(0, 20) : '-',
			checkIn.salesValue, checkIn.quotationNumber, checkIn.quotationStatus,
			checkIn.notes ? checkIn.notes.substring(0, 20) : '-',
			checkIn.resolution ? checkIn.resolution.substring(0, 20) : '-',
			checkIn.followUp ? checkIn.followUp.substring(0, 20) : '-'
		];

		values.forEach((value, i) => {
			doc.rect(x, y, colWidths[i], rowHeight).strokeColor(COLOR_LINE).stroke();
			doc.text(String(value || '-'), x + 2, y + 2, { width: colWidths[i] - 4, align: 'left' });
			x += colWidths[i];
		});

		y += rowHeight;
	});

	// Footer
	const footerY = doc.page.height - PAGE_MARGIN - 10;
	doc.fontSize(FONT_SIZE_SMALL).font(FONT_REGULAR).fillColor(COLOR_TEXT_NORMAL);
	doc.text(`Report generated on ${data.generatedAt}`, PAGE_MARGIN, footerY, { align: 'left' });
	doc.text(`Page ${doc.page.number}`, doc.page.width - PAGE_MARGIN - 50, footerY, { align: 'right' });
}
