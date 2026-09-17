export const PRODUCT_TIME_ZONE = "Asia/Taipei" as const;

export type Author = "kitty" | "master" | "system";

export type SpecialDayType = "anniversary" | "birthday";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CalendarMonth {
  year: number;
  month: number;
}

export interface EventDTO {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string | null;
  precision: string | null;
  eventType: string | null;
  source: string | null;
  createdBy: string | null;
  revision: number | null;
  status: string | null;
  metadata: JsonValue | null;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface EventWritePayload {
  title: string;
  starts_at: string;
  ends_at: string;
  precision: "hour" | "day";
  event_type: SpecialDayType | "custom";
  metadata?: JsonValue;
}

export interface EventDraft {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  eventType: SpecialDayType | null;
}

export interface CalendarEvent {
  id: string;
  author: Author;
  title: string;
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  isAllDay: boolean;
  isAutoSuggestion: boolean;
  eventType: string | null;
  revision: number | null;
  source: string | null;
}

export interface CalendarSpanClip {
  headStart?: string;
  tailEnd?: string;
}

export interface CalendarSpan {
  id: string;
  author: Author;
  title: string;
  startDay: number;
  endDay: number;
  clip?: CalendarSpanClip;
  revision: number | null;
}

export interface SpanDraft {
  title: string;
  month: CalendarMonth;
  startDay: number;
  endDay: number;
}

export interface NoteDTO {
  id: string;
  eventId: string | null;
  anchorDate: string;
  author: string | null;
  body: string;
  y: number | null;
  liked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface CalendarNote {
  id: string;
  author: Author;
  body: string;
  timestamp: string;
  liked: boolean;
  linkedEventId: string | null;
  y: number | null;
  anchorDate: string;
}

export interface NoteWritePayload {
  body?: string;
  anchor_date?: string;
  y?: number;
  liked?: boolean;
  event_id?: string | null;
}

export interface DayRange {
  start: number;
  end: number;
}

export interface MonthPayload {
  events: Map<number, CalendarEvent[]>;
  spans: CalendarSpan[];
  periods: DayRange[];
}

export interface DayEvent {
  id: string;
  author: Author;
  title: string;
  description: string | null;
  eventType: string | null;
  isAllDay: boolean;
  isSpan: boolean;
  originalStartsAt: string;
  originalEndsAt: string | null;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  spanIndex: number | null;
  spanLength: number | null;
  revision: number | null;
}

export interface DayPayload {
  allDay: DayEvent[];
  timed: DayEvent[];
}

export const SPECIAL_DAY_TYPES: ReadonlySet<SpecialDayType> = new Set(["anniversary", "birthday"]);

export function isSpecialDayType(value: string | null | undefined): value is SpecialDayType {
  return typeof value === "string" && SPECIAL_DAY_TYPES.has(value as SpecialDayType);
}
