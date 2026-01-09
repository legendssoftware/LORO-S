export interface ImportResult {
	created: number;
	updated: number;
	skipped: number;
	errors: Array<{ code: string; error: string }>;
}

export interface ImportSummary {
	products: ImportResult;
	clients: ImportResult;
	timestamp: Date;
}
