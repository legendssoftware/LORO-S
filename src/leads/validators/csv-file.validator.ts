import { FileValidator } from '@nestjs/common';

export class CsvFileValidator extends FileValidator<Record<string, any>> {
	constructor(validationOptions?: Record<string, any>) {
		super(validationOptions || {});
	}

	buildErrorMessage(): string {
		return 'File must be a CSV file (.csv extension)';
	}

	isValid(file: Express.Multer.File): boolean {
		if (!file) {
			return false;
		}

		// Check file extension first (most reliable)
		const fileName = (file as any).originalname || '';
		const hasCsvExtension = fileName.toLowerCase().endsWith('.csv');

		// Check mimetype
		const mimetype = file.mimetype?.toLowerCase() || '';
		const validCsvMimeTypes = ['text/csv', 'application/csv'];
		const isValidCsvMimeType = validCsvMimeTypes.some(
			(mimeType) => mimetype === mimeType.toLowerCase(),
		);

		// Accept if:
		// 1. File has .csv extension (regardless of mimetype - handles browser inconsistencies)
		// 2. OR mimetype is a valid CSV mimetype
		// This handles cases where browsers send text/plain or other mimetypes for CSV files
		return hasCsvExtension || isValidCsvMimeType;
	}
}
