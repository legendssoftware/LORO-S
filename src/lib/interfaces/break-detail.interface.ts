export interface BreakDetail {
  startTime: Date;
  endTime: Date | null;
  duration: string | null;
  latitude?: string | null;
  longitude?: string | null;
  notes?: string | null;
} 