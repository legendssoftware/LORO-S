/**
 * Shared response shape for server-generated domain reports.
 * Used by GET /:domain/report endpoints so the client receives all chart/map data in one response.
 */
export interface ByStatusItemDto {
	name: string;
	value: number;
}

export interface ByDayItemDto {
	date: string;
	count: number;
}

export interface ReportMetaDto {
	from: string;
	to: string;
}

export interface DomainReportResponseDto {
	total: number;
	byStatus: ByStatusItemDto[];
	byDay: ByDayItemDto[];
	meta: ReportMetaDto;
}
