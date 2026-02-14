import { TimezoneUtil } from '../../lib/utils/timezone.util';

const EXTERNAL_MACHINE_MARKER = '[External Machine: LEGEND_PEOPLE] Morning Clock Ins]';

interface AttendanceLike {
	uid?: number;
	checkIn?: Date;
	checkOut?: Date;
	breakStartTime?: Date;
	breakEndTime?: Date;
	createdAt?: Date;
	updatedAt?: Date;
	verifiedAt?: Date;
	checkInNotes?: string;
	[key: string]: any;
}

const DATE_FIELDS = [
	'checkIn',
	'checkOut',
	'breakStartTime',
	'breakEndTime',
	'createdAt',
	'updatedAt',
	'verifiedAt',
] as const;

function shouldSkipConversion(record: AttendanceLike): boolean {
	return !!(
		record.checkInNotes &&
		record.checkInNotes.includes(EXTERNAL_MACHINE_MARKER)
	);
}

/** Convert a single attendance record's date fields to org timezone for serialization. */
export function convertAttendanceRecordToTimezone<T extends AttendanceLike>(
	record: T,
	timezone: string,
): T {
	if (!record || shouldSkipConversion(record)) return record;
	const converted = { ...record };
	for (const field of DATE_FIELDS) {
		if (converted[field]) {
			(converted as any)[field] = TimezoneUtil.toOrganizationTimeForSerialization(
				converted[field],
				timezone,
			);
		}
	}
	return converted;
}

/** Convert multiple attendance records to org timezone. */
export function convertAttendanceRecordsToTimezone<T extends AttendanceLike>(
	records: T[],
	timezone: string,
): T[] {
	if (!records?.length) return records;
	return records.map((r) => convertAttendanceRecordToTimezone(r, timezone));
}

/** Resolve org ID from record for timezone lookup. */
export function resolveOrgIdFromRecord(record: AttendanceLike): string | undefined {
	if (record.owner?.organisation?.clerkOrgId) return record.owner.organisation.clerkOrgId;
	if (record.owner?.organisation?.ref) return record.owner.organisation.ref;
	if (record.organisation?.clerkOrgId) return record.organisation.clerkOrgId;
	if (record.organisation?.ref) return record.organisation.ref;
	return undefined;
}

/** Ensure attendance data (single, array, or nested) is timezone-converted. */
export async function ensureTimezoneConversion(
	data: any,
	organizationId: string | undefined,
	getTimezone: (orgId?: string) => Promise<string>,
): Promise<any> {
	if (!data) return data;
	const getTz = (orgId?: string) => getTimezone(orgId ?? organizationId);
	try {
		if (data.uid && data.checkIn) {
			const tz = await getTz(resolveOrgIdFromRecord(data));
			return convertAttendanceRecordToTimezone(data, tz);
		}
		if (Array.isArray(data)) {
			const withCheckIn = data.filter((i: any) => i?.checkIn);
			if (!withCheckIn.length) return data;
			const tz = await getTz();
			return convertAttendanceRecordsToTimezone(data, tz);
		}
		if (typeof data === 'object') {
			const result = { ...data };
			const keys = ['checkIns', 'attendanceRecords', 'activeShifts', 'multiDayShifts', 'ongoingShifts'];
			for (const key of keys) {
				if (Array.isArray(result[key]) && result[key].some((i: any) => i?.checkIn)) {
					const tz = await getTz();
					result[key] = convertAttendanceRecordsToTimezone(result[key], tz);
				}
			}
			if (result.attendance?.checkIn) {
				const tz = await getTz(resolveOrgIdFromRecord(result.attendance));
				result.attendance = convertAttendanceRecordToTimezone(result.attendance, tz);
			}
			return result;
		}
		return data;
	} catch {
		return data;
	}
}
